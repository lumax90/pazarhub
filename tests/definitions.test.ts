import { describe, expect, it } from 'vitest'
import { createEmptyState } from '../src/domain/empty-state'
import { executeCommand } from '../src/domain/operations'
import {
  categoryPath,
  categoryTree,
  COLOR_DEFINITION_ID,
  definitionOrderKey,
  definitionUsage,
  hydrateDefinitionReferences,
  initializeDefinitions,
} from '../src/domain/definitions'
import { findVariant } from '../src/domain/selectors'
import type { AppState, CatalogDefinition, Command, DefinitionKind } from '../src/domain/types'
import { catalogParts } from './catalog-workspace-fixture'
const now = '2026-10-23T10:00:00.000Z'
const apply = (state: AppState, command: Command) => {
  const outcome = executeCommand(state, command, now)
  expect(outcome.result.ok, outcome.result.message).toBe(true)
  return outcome.state
}
const definition = (
  id: string,
  kind: DefinitionKind,
  name: string,
  extra: Partial<CatalogDefinition> = {},
): CatalogDefinition => ({ id, kind, name, sortOrder: 0, version: 0, active: true, ...extra })
function workspace() {
  let state = createEmptyState('Tanım')
  state.warehouses = [
    { id: 'main', name: 'Merkez', active: true },
    { id: 'shop', name: 'Mağaza', active: true },
  ]
  for (const product of catalogParts()) state = apply(state, { type: 'product.save', product })
  return state
}

describe('catalog definitions and product relationships', () => {
  it('initializes legacy names and stable references once, without guessing a hierarchy or color', () => {
    const state = createEmptyState('Eski firma')
    state.products = catalogParts()
    state.products[0].category = 'Ev / Banyo'
    state.products[0].variantAxes = [
      { id: 'color', name: 'Renk', values: [{ id: 'cream', name: 'Krem' }] },
    ]
    state.products[0].variants[0].options = { color: 'cream' }
    delete state.definitions
    initializeDefinitions(state)
    expect(
      (state as AppState).definitions?.find((d) => d.name === 'Ev / Banyo')?.parentId,
    ).toBeUndefined()
    const color = (state as AppState).definitions?.find(
      (d) => d.kind === 'color' && d.name === 'Krem',
    )
    expect(color?.colorHex).toBeUndefined()
    expect(state.products[0].variantAxes[0].values[0].definitionValueId).toBe(color?.id)
    const saved = structuredClone(state)
    initializeDefinitions(state)
    hydrateDefinitionReferences(state)
    expect(state).toEqual(saved)
  })

  it('renames and moves a category subtree while preserving product, listing mapping and margin identities', () => {
    let state = workspace()
    const category = state.definitions!.find((d) => d.kind === 'category')!
    state.categoryMappings = [
      {
        id: 'mapping',
        storeId: 'store',
        localCategory: 'Banyo',
        categoryId: 'remote-1',
        categoryName: 'Banyo',
        attributes: {},
        version: 1,
        updatedAt: now,
      },
    ]
    state.marginRules = [
      {
        id: 'margin',
        storeId: 'store',
        scope: 'category',
        value: 'Banyo',
        base: 'price',
        markupBps: 1000,
        commissionBps: 0,
        fixedCost: 0,
        active: true,
      },
    ]
    state = apply(state, {
      type: 'definition.save',
      definition: definition('home', 'category', 'Ev'),
    })
    const key = definitionOrderKey(state.definitions!, 'category')
    state = apply(state, {
      type: 'definition.move',
      id: category.id,
      parentId: 'home',
      expectedOrder: key,
    })
    expect(
      state.products.every((p) => p.category === 'Ev / Banyo' && p.categoryId === category.id),
    ).toBe(true)
    expect(state.categoryMappings?.[0]).toMatchObject({
      categoryId: 'remote-1',
      localCategory: 'Ev / Banyo',
      version: 2,
    })
    expect(state.marginRules?.[0].value).toBe('Ev / Banyo')
    expect(
      executeCommand(state, { type: 'definition.move', id: category.id, expectedOrder: key }).result
        .ok,
    ).toBe(false)
    const parent = state.definitions!.find((d) => d.id === 'home')!
    state = apply(state, { type: 'definition.save', definition: { ...parent, name: 'Ev Yaşam' } })
    expect(findVariant(state, 'a')!.product.category).toBe('Ev Yaşam / Banyo')
    expect(
      executeCommand(state, {
        type: 'product.patch',
        id: 'part-a',
        expectedVersion: 1,
        patch: { changes: { name: 'Eski taslak' } },
      }).result.ok,
    ).toBe(false)
  })

  it('rejects cycles and deactivates children while preserving existing product selections', () => {
    let state = workspace()
    state = apply(state, {
      type: 'definition.save',
      definition: definition('parent', 'category', 'Ev'),
    })
    const category = state.definitions!.find((d) => d.name === 'Banyo')!
    state = apply(state, {
      type: 'definition.save',
      definition: { ...category, parentId: 'parent' },
    })
    const parent = state.definitions!.find((d) => d.id === 'parent')!
    const cycle = executeCommand(state, {
      type: 'definition.save',
      definition: { ...parent, parentId: category.id },
    })
    expect(cycle.result.ok).toBe(false)
    expect(cycle.state).toBe(state)
    state = apply(state, { type: 'definition.save', definition: { ...parent, active: false } })
    expect(state.definitions!.find((d) => d.id === category.id)?.active).toBe(false)
    const current = findVariant(state, 'a')!.product
    state = apply(state, {
      type: 'product.patch',
      id: current.id,
      expectedVersion: current.version!,
      patch: { changes: { subtitle: 'Mevcut ürün' } },
    })
    const product = {
      ...catalogParts()[0],
      id: 'new',
      category: 'Ev / Banyo',
      categoryId: category.id,
      variants: [{ ...catalogParts()[0].variants[0], id: 'new-v', sku: 'NEW', barcode: '0099' }],
    }
    expect(executeCommand(state, { type: 'product.save', product }).result.ok).toBe(false)
    expect(
      executeCommand(state, {
        type: 'definition.delete',
        id: 'parent',
        version: 2,
        expectedUsage: 0,
      }).result.ok,
    ).toBe(false)
  })

  it('uses definition identities in a new draft after a rename and rejects a deleted identity', () => {
    let state = workspace()
    const category = state.definitions!.find((d) => d.kind === 'category')!
    const draft = {
      ...catalogParts()[0],
      id: 'draft',
      categoryId: category.id,
      variants: [
        { ...catalogParts()[0].variants[0], id: 'draft-v', sku: 'DRAFT', barcode: '0090' },
      ],
    }
    state = apply(state, {
      type: 'definition.save',
      definition: { ...category, name: 'Banyo ürünleri' },
    })
    state = apply(state, { type: 'product.save', product: draft })
    expect(findVariant(state, 'draft-v')!.product.category).toBe('Banyo ürünleri')
    expect(state.definitions?.some((d) => d.name === 'Banyo')).toBe(false)
    expect(
      executeCommand(state, {
        type: 'product.patch',
        id: 'draft',
        expectedVersion: 1,
        patch: { changes: { categoryId: 'deleted' } },
      }).result.ok,
    ).toBe(false)
  })

  it('keeps color as a protected system variant and renames used color values without breaking SKUs', () => {
    let state = workspace()
    const product = findVariant(state, 'a')!.product
    state = apply(state, {
      type: 'product.patch',
      id: product.id,
      expectedVersion: 1,
      patch: {
        changes: {
          variantAxes: [{ id: 'axis', name: 'Renk', values: [{ id: 'cream', name: 'Krem' }] }],
        },
        variants: [{ id: 'a', name: 'Krem', options: { axis: 'cream' } }],
      },
    })
    const system = state.definitions!.find((d) => d.id === COLOR_DEFINITION_ID)!
    for (const command of [
      { type: 'definition.save', definition: { ...system, active: false } },
      { type: 'definition.save', definition: { ...system, name: 'Başka' } },
      { type: 'definition.delete', id: system.id, version: system.version, expectedUsage: 1 },
    ] as Command[])
      expect(executeCommand(state, command).result.ok).toBe(false)
    const color = state.definitions!.find((d) => d.kind === 'color')!
    state = apply(state, {
      type: 'definition.save',
      definition: { ...color, name: 'Ekru', colorHex: '#f4ead4' },
    })
    expect(findVariant(state, 'a')!.variant).toMatchObject({
      sku: 'HAVLU',
      name: 'Ekru',
      options: { axis: 'cream' },
    })
    expect(
      executeCommand(state, {
        type: 'definition.delete',
        id: color.id,
        version: color.version + 1,
        expectedUsage: 1,
      }).result.ok,
    ).toBe(false)
  })

  it('removes only deleted technical values and checks the usage count before cascading to products', () => {
    let state = workspace()
    state = apply(state, {
      type: 'definition.save',
      definition: definition('material', 'attribute', 'Malzeme', {
        values: [
          { id: 'cotton', name: 'Pamuk', active: true, sortOrder: 0 },
          { id: 'linen', name: 'Keten', active: true, sortOrder: 1 },
        ],
      }),
    })
    state = apply(state, {
      type: 'product.patch',
      id: 'part-a',
      expectedVersion: 1,
      patch: {
        changes: {
          technicalAttributes: [
            {
              id: 'a-material',
              name: 'Malzeme',
              value: 'Pamuk, Keten',
              definitionId: 'material',
              valueIds: ['cotton', 'linen'],
            },
          ],
        },
      },
    })
    const material = state.definitions!.find((d) => d.id === 'material')!
    expect(definitionUsage(state, material, 'cotton')).toBe(1)
    expect(
      executeCommand(state, {
        type: 'definition.value.delete',
        id: material.id,
        version: material.version,
        valueId: 'cotton',
        expectedUsage: 0,
      }).result.ok,
    ).toBe(false)
    state = apply(state, {
      type: 'definition.value.delete',
      id: material.id,
      version: material.version,
      valueId: 'cotton',
      expectedUsage: 1,
    })
    expect(findVariant(state, 'a')!.product.technicalAttributes?.[0]).toMatchObject({
      value: 'Keten',
      valueIds: ['linen'],
      valueLabels: ['Keten'],
    })
    state = apply(state, {
      type: 'definition.delete',
      id: material.id,
      version: material.version + 1,
      expectedUsage: 1,
    })
    expect(findVariant(state, 'a')!.product.technicalAttributes).toEqual([])
  })

  it('reorders adjacent definitions atomically and protects definitions used only by mappings', () => {
    let state = workspace()
    for (const name of ['Z', 'A', 'M'])
      state = apply(state, {
        type: 'definition.save',
        definition: definition(name, 'attribute', name),
      })
    const order = definitionOrderKey(state.definitions!, 'attribute')
    state = apply(state, { type: 'definition.move', id: 'Z', beforeId: 'M', expectedOrder: order })
    expect(
      state
        .definitions!.filter((d) => d.kind === 'attribute')
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((d) => d.id),
    ).toEqual(['A', 'Z', 'M'])
    expect(
      executeCommand(state, {
        type: 'definition.move',
        id: 'M',
        beforeId: 'Z',
        expectedOrder: order,
      }).result.ok,
    ).toBe(false)
    state = apply(state, {
      type: 'definition.save',
      definition: definition('empty', 'category', 'Boş'),
    })
    state.categoryMappings = [
      {
        id: 'remote',
        storeId: 'store',
        categoryId: 'r',
        categoryName: 'r',
        attributes: {},
        localCategory: 'Boş',
        version: 1,
        updatedAt: now,
      },
    ]
    expect(
      executeCommand(state, {
        type: 'definition.delete',
        id: 'empty',
        version: 1,
        expectedUsage: 0,
      }).result.ok,
    ).toBe(false)
    expect(
      categoryTree(state.definitions!).map((d) => categoryPath(state.definitions!, d)),
    ).toContain('Boş')
  })
})
