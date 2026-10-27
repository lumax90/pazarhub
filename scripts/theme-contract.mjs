import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import ts from 'typescript'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export const appearance =
  /^(?:color|background(?:-.+)?|border(?:-.+)?|box-shadow|text-shadow|outline(?:-.+)?|font(?:-.+)?|line-height|letter-spacing|text-decoration(?:-.+)?|text-transform|opacity|filter|backdrop-filter|-webkit-backdrop-filter|fill|stroke|accent-color|color-scheme|content)$/
export const oldTokens = new Set([
  'canvas',
  'canvas-glow',
  'text',
  'text-secondary',
  'text-muted',
  'line',
  'line-strong',
  'soft',
  'blue-soft',
  'green',
  'green-soft',
  'amber',
  'amber-soft',
  'red',
  'red-soft',
  'sidebar',
  'header-glass',
  'chart-blue',
  'panel-shadow',
  'theme-preview-light',
  'theme-preview-dark',
])
export function sourceFiles(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(file, extension)
      : file.endsWith(extension)
        ? [file]
        : []
  })
}

// Includes conditional/template class names on routes not currently mounted.
export function componentInventory(root = projectRoot) {
  const nativeClasses = new Set()
  const kinds = new Map()
  const directory = path.join(root, 'node_modules/@heroui/styles/dist/components')
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.css'))) {
    postcss.parse(readFileSync(path.join(directory, file), 'utf8')).walkRules((rule) => {
      if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return
      selectorParser((selectors) =>
        selectors.walkClasses((node) => nativeClasses.add(node.value)),
      ).processSync(rule.selector)
    })
  }
  const wrappers = new Map([
    ['Panel', 'card'],
    ['Metric', 'card'],
    ['Field', 'text-field'],
    ['SearchBox', 'search-field'],
    ['SearchSelect', 'combo-box'],
    ['SelectButton', 'select'],
    ['IconButton', 'button'],
  ])
  const controls = []
  for (const file of sourceFiles(path.join(root, 'src'), '.tsx')) {
    const text = readFileSync(file, 'utf8')
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const imports = new Set(),
      variables = new Map()
    function collect(node) {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === '@heroui/react') {
        for (const element of node.importClause?.namedBindings?.elements ?? [])
          imports.add(element.name.text)
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        variables.set(node.name.text, node.initializer)
      ts.forEachChild(node, collect)
    }
    collect(tree)
    // Motion's native-component adapter keeps the HeroUI skin and must be
    // checked just like a directly imported Card/Button/etc.
    for (const [name, expression] of variables) {
      if (
        ts.isCallExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === 'create' &&
        expression.arguments[0] &&
        ts.isIdentifier(expression.arguments[0]) &&
        imports.has(expression.arguments[0].text)
      ) {
        imports.add(name)
      }
    }
    function strings(node, seen = new Set()) {
      if (!node) return []
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
      if (ts.isTemplateExpression(node))
        return [
          node.head.text,
          ...node.templateSpans.flatMap((span) => [
            ...strings(span.expression, seen),
            span.literal.text,
          ]),
        ]
      if (ts.isJsxExpression(node)) return strings(node.expression, seen)
      if (ts.isIdentifier(node) && !seen.has(node.text) && variables.has(node.text))
        return strings(variables.get(node.text), new Set([...seen, node.text]))
      if (ts.isConditionalExpression(node))
        return [...strings(node.whenTrue, seen), ...strings(node.whenFalse, seen)]
      if (ts.isBinaryExpression(node))
        return [...strings(node.left, seen), ...strings(node.right, seen)]
      if (ts.isArrowFunction(node)) return strings(node.body, seen)
      if (ts.isParenthesizedExpression(node)) return strings(node.expression, seen)
      return []
    }
    function walk(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(tree),
          base = tag.split('.')[0]
        const attr = node.attributes.properties.find(
          (prop) => ts.isJsxAttribute(prop) && prop.name.getText(tree) === 'className',
        )
        const names = strings(attr?.initializer)
          .flatMap((value) => value.split(/\s+/))
          .filter((value) => /^[a-z][\w-]*$/.test(value) && !value.startsWith('is-'))
        const nativeElement =
          imports.has(base) ||
          wrappers.has(base) ||
          ['button', 'input', 'textarea', 'select', 'label'].includes(tag)
        const native = nativeElement || names.some((name) => nativeClasses.has(name))
        if (native) {
          const kind = wrappers.get(base) || (imports.has(base) ? base.toLowerCase() : tag)
          const expression =
            attr?.initializer && ts.isJsxExpression(attr.initializer)
              ? attr.initializer.expression
              : undefined
          const nativeNames =
            !nativeElement && expression && ts.isConditionalExpression(expression)
              ? strings(expression)
                  .map((value) => value.split(/\s+/))
                  .filter((group) => group.some((name) => nativeClasses.has(name)))
                  .flat()
              : names
          for (const name of nativeNames) {
            nativeClasses.add(name)
            if (!kinds.has(name)) kinds.set(name, new Set())
            kinds.get(name).add(kind)
          }
          controls.push({
            file: path.relative(root, file).replaceAll('\\', '/'),
            line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
            tag,
            classes: names,
            node,
            tree,
          })
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(tree)
  }
  const nativePrefixes = [...nativeClasses].filter((name) => name.endsWith('-'))
  return { nativeClasses, nativePrefixes, kinds, controls }
}

export function selectorSubjects(selector) {
  return selectorParser()
    .astSync(selector)
    .nodes.map((node) => {
      let last = -1
      node.nodes.forEach((child, index) => {
        if (child.type === 'combinator') last = index
      })
      const nodes = node.nodes.slice(last + 1)
      const classes = [],
        tags = [],
        attributes = []
      function walk(items) {
        for (const child of items) {
          if (child.type === 'class') classes.push(child.value)
          if (child.type === 'tag') tags.push(child.value)
          if (child.type === 'attribute')
            attributes.push({ name: child.attribute, value: child.value })
          if (child.type === 'pseudo' && [':is', ':where'].includes(child.value))
            for (const nested of child.nodes ?? []) walk(nested.nodes ?? [])
        }
      }
      walk(nodes)
      return { selector: node.toString().trim(), classes, tags, attributes }
    })
}
export function nativeSubject(subject, inventory) {
  return (
    subject.classes.some(
      (name) =>
        inventory.nativeClasses.has(name) ||
        inventory.nativePrefixes?.some((prefix) => name.startsWith(prefix)),
    ) ||
    subject.tags.some((tag) => ['button', 'input', 'textarea', 'select', 'label'].includes(tag)) ||
    subject.attributes.some(
      ({ name, value }) =>
        name === 'data-slot' ||
        (name === 'class' &&
          (value ?? '')
            .split(/\s+/)
            .some(
              (token) =>
                inventory.nativeClasses.has(token) ||
                inventory.nativePrefixes?.some((prefix) => token.startsWith(prefix)),
            )) ||
        (name === 'role' &&
          /^(?:button|checkbox|radio|switch|menuitem|option|tab|gridcell)/.test(value ?? '')),
    )
  )
}

export function stylesheetViolations(css, relative, inventory) {
  const errors = []
  const sheet = postcss.parse(css, { from: relative })
  sheet.walkAtRules('apply', (rule) =>
    errors.push(
      `${relative}:${rule.source.start.line} Native görünüm @apply ile yeniden yazılamaz; bileşen varyantını kullanın.`,
    ),
  )
  sheet.walkRules((rule) => {
    if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return
    const subjects = selectorSubjects(rule.selector)
    const native = subjects.some((subject) => nativeSubject(subject, inventory))
    // Exempt only paper output and actual brand/art selectors, not whole files.
    let paper = relative === 'src/styles/print.css' && /\.order-print/.test(rule.selector)
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent)
      if (
        relative === 'src/styles/print.css' &&
        parent.type === 'atrule' &&
        parent.name === 'media' &&
        /\bprint\b/.test(parent.params)
      )
        paper = true
    const content =
      relative === 'src/styles/content.css' &&
      subjects.every((subject) =>
        subject.classes.some((name) => /^(?:channel-icon|distribution-|product-art)/.test(name)),
      )
    rule.walkDecls((decl) => {
      const at = `${relative}:${decl.source.start.line}`
      if (!paper && native && appearance.test(decl.prop))
        errors.push(`${at} Native görünüm CSS'ten ezilemez: ${rule.selector} → ${decl.prop}`)
      if (
        !paper &&
        native &&
        !appearance.test(decl.prop) &&
        relative !== 'src/styles/structure.css'
      )
        errors.push(
          `${at} Native bileşen yerleşimi structure.css içinde tanımlanmalı: ${rule.selector}`,
        )
      if (
        !paper &&
        !content &&
        /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(|\b(?:white|black|red|blue|green|gray|grey|orange|purple)\b/i.test(
          decl.value,
        ) &&
        (appearance.test(decl.prop) || decl.prop.startsWith('--'))
      )
        errors.push(`${at} Tema dışında sabit renk: ${decl.prop}: ${decl.value}`)
      for (const match of decl.value.matchAll(/var\(--([\w-]+)/g))
        if (oldTokens.has(match[1])) errors.push(`${at} Eski tema takma adı: --${match[1]}`)
      if (
        !paper &&
        (!content || decl.prop === 'border-radius') &&
        /^(?:font-size|border-radius)$/.test(decl.prop) &&
        /\d(?:px|rem)/.test(decl.value)
      )
        errors.push(`${at} Tema ölçeği yerine sabit ölçü: ${decl.prop}: ${decl.value}`)
      if (decl.prop.startsWith('--') && !decl.prop.startsWith('--app-'))
        errors.push(`${at} Tema değişkeni yalnız tema dosyasında tanımlanabilir: ${decl.prop}`)
      if (
        !paper &&
        !content &&
        decl.prop === 'font-family' &&
        !/^var\(--font-(?:sans|mono)\)$/.test(decl.value)
      )
        errors.push(`${at} Yazı ailesi tema değişkenini kullanmalı.`)
    })
  })
  return errors
}

/** Normalize a token-only Theme Builder export, including named light/dark themes. */
export function normalizeTheme(css) {
  const sheet = postcss.parse(css),
    rules = []
  sheet.walkAtRules((rule) => {
    if (!['layer', 'theme'].includes(rule.name))
      throw new Error(
        `Tema dışa aktarımında desteklenmeyen @${rule.name}. Yazı tipi importunu src/styles.css dosyasına ekleyin.`,
      )
    if (rule.name === 'layer' && rule.params !== 'base' && rule.params !== 'theme')
      throw new Error('Tema dosyası bileşen katmanını değiştiremez.')
  })
  sheet.walkDecls((decl) => {
    if (!decl.prop.startsWith('--') && decl.prop !== 'color-scheme')
      throw new Error(`Tema dosyası yalnız değişken içerebilir: ${decl.prop}`)
    if (oldTokens.has(decl.prop.slice(2)))
      throw new Error(`Eski tema değişkeni kullanılamaz: ${decl.prop}`)
  })
  sheet.walkRules((rule) => {
    const mode = rule.nodes.find(
      (node) => node.type === 'decl' && node.prop === 'color-scheme',
    )?.value
    const subjects = selectorSubjects(rule.selector)
    if (
      subjects.some(
        (subject) =>
          subject.tags.length ||
          subject.classes.some((name) =>
            /^(?:button|input|card|chip|tabs|modal|select|radio|checkbox)(?:$|__|--)/.test(name),
          ),
      )
    )
      throw new Error('Tema dosyası bileşen seçicisi içeremez.')
    if (mode === 'dark' || (!mode && /dark/.test(rule.selector)))
      rule.selector = '.dark, [data-theme="dark"]'
    else if (mode === 'light') rule.selector = ':root, .light, [data-theme="light"]'
    else if (subjects.every((subject) => /^:root$|^:host$/.test(subject.selector)))
      rule.selector = ':root'
    else if (
      !mode &&
      subjects.every((subject) =>
        /^\.light$|^\[data-theme=["']?light["']?\]$/.test(subject.selector),
      )
    )
      rule.selector = '.light, [data-theme="light"]'
    else throw new Error(`Tema seçicisinde açık/koyu color-scheme belirtilmeli: ${rule.selector}`)
    rules.push(rule)
  })
  if (!rules.length) throw new Error('Tema değişkenleri bulunamadı.')
  const base = postcss.atRule({ name: 'layer', params: 'base' })
  for (const rule of rules) base.append(rule.clone())
  const output = postcss.root({ nodes: [base] })
  sheet.walkAtRules('theme', (rule) => output.append(rule.clone()))
  return output.toString() + '\n'
}

export function auditTheme(root = projectRoot) {
  const inventory = componentInventory(root),
    errors = []
  const cssFiles = sourceFiles(path.join(root, 'src'), '.css')
  // React Aria measures the ComboBox trigger and supplies --trigger-width at runtime.
  const knownTokens = new Set(['--product-color', '--trigger-width'])
  for (const file of [
    ...sourceFiles(path.join(root, 'node_modules/@heroui/styles/dist/themes'), '.css'),
    path.join(root, 'node_modules/tailwindcss/theme.css'),
    ...cssFiles,
  ])
    for (const match of readFileSync(file, 'utf8').matchAll(/(--[\w-]+)\s*:/g))
      knownTokens.add(match[1])
  const entry = postcss.parse(readFileSync(path.join(root, 'src/styles.css'), 'utf8'))
  const imports = entry.nodes
    .filter((node) => node.type === 'atrule' && node.name === 'import')
    .map((node) => node.params)
  const themeImports = imports.filter((value) => value.includes('./styles/heroui-theme.css'))
  if (
    themeImports.length !== 1 ||
    imports.findIndex((value) => value.includes('@heroui/styles')) >=
      imports.findIndex((value) => value.includes('./styles/heroui-theme.css'))
  )
    errors.push('src/styles.css: Tek tema girişi @heroui/styles importundan sonra gelmeli.')
  for (const file of cssFiles) {
    const relative = path.relative(root, file).replaceAll('\\', '/'),
      css = readFileSync(file, 'utf8')
    for (const match of css.matchAll(/var\((--[\w-]+)/g))
      if (!knownTokens.has(match[1]))
        errors.push(`${relative}: Tanımsız tema değişkeni ${match[1]}`)
    if (relative === 'src/styles/heroui-theme.css') {
      try {
        normalizeTheme(css)
      } catch (error) {
        errors.push(`${relative}: ${error.message}`)
      }
    } else errors.push(...stylesheetViolations(css, relative, inventory))
  }
  for (const control of inventory.controls) {
    const { node, tree } = control
    const at = `${control.file}:${control.line}`
    if (
      control.tag === 'button' &&
      !control.classes.some((name) => ['button', 'close-button', 'bg-backdrop'].includes(name))
    )
      errors.push(`${at} HTML düğme native HeroUI sınıfını kullanmalı.`)
    const style = node.attributes.properties.find(
      (prop) => ts.isJsxAttribute(prop) && prop.name.getText(tree) === 'style',
    )
    if (
      style?.initializer &&
      ts.isJsxExpression(style.initializer) &&
      style.initializer.expression &&
      ts.isObjectLiteralExpression(style.initializer.expression)
    ) {
      for (const prop of style.initializer.expression.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        const name = prop.name
          .getText(tree)
          .replaceAll(/['"]/g, '')
          .replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
        if (appearance.test(name))
          errors.push(`${at} Native bileşende satır içi görünüm kullanılamaz: ${name}`)
      }
    }
  }
  return { errors, cssFiles: cssFiles.length, controls: inventory.controls.length, inventory }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditTheme()
  console.log(
    `Tema sözleşmesi: ${result.cssFiles} CSS dosyası, ${result.controls} bileşen kullanımı.`,
  )
  if (result.errors.length) {
    console.error(result.errors.join('\n'))
    console.error(`${result.errors.length} tema ihlali.`)
    process.exitCode = 1
  } else console.log('Native bileşen görünümü ve merkezi tema kuralları doğrulandı.')
}
