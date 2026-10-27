import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { format, resolveConfig } from 'prettier'
import { normalizeTheme, projectRoot } from './theme-contract.mjs'

const args = process.argv.slice(2),
  check = args.includes('--check'),
  source = args.find((arg) => !arg.startsWith('--'))
if (!source) {
  console.error('Kullanım: npm run theme:apply -- "tema.css" [--check]')
  process.exitCode = 1
} else {
  let temporary
  try {
    const destination = path.join(projectRoot, 'src/styles/heroui-theme.css')
    const css = await format(normalizeTheme(await readFile(path.resolve(source), 'utf8')), {
      ...(await resolveConfig(destination)),
      parser: 'css',
    })
    if (check) console.log('Tema geçerli. Açık/koyu değişkenler uygulama ile uyumlu.')
    else {
      temporary = destination + '.tmp'
      await writeFile(temporary, css)
      await rename(temporary, destination)
      console.log('Tema uygulandı: src/styles/heroui-theme.css')
    }
  } catch (error) {
    if (temporary) await unlink(temporary).catch(() => {})
    console.error(error.message)
    process.exitCode = 1
  }
}
