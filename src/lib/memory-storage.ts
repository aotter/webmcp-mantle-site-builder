import {
  DEFAULT_SITE_ICONS,
  DiagnosticError,
  isCtxUserRef,
  isParamRef,
  runtimeDiagnostic,
  type Entry,
  type FilterAst,
  type MediaPurposePolicy,
  type SchemaManifest,
  type SiteConfig,
  type SiteDefaults,
} from '@aotter/mantle-spec'
import {
  EntryStatusConflict,
  EntryUniqueConflict,
  EntryVersionConflict,
  clampLimit,
  clampPage,
  clampShow,
  decodeEntrySortCursor,
  encodeEntrySortCursor,
  liftLocale,
  projectPublicEntry,
  type CreateEntryArgs,
  type DeleteEntryArgs,
  type EntryReader,
  type EntryRepository,
  type EntryRow,
  type FindEntryByDataFieldArgs,
  type FindEntryByDataFieldsArgs,
  type FindManyEntriesByDataFieldArgs,
  type ListEntriesArgs,
  type ListEntriesResult,
  type LogicalViewPlan,
  type MantleStorageAdapter,
  type PreparedMantleStorage,
  type ReadEntriesByDataFieldInArgs,
  type ReadEntryByDataFieldArgs,
  type ReadEntryBySlugArgs,
  type ReadPublishedEntriesArgs,
  type RuntimePlan,
  type SiteConfigRepository,
  type TransitionStatusArgs,
  type UpdateEditableSiteConfigArgs,
  type UpdateEntryArgs,
  type ViewQueryExecutor,
  type ViewQueryRequest,
  type ViewQueryResult,
} from '@aotter/mantle-runtime'

export class MemoryMantleStorageAdapter implements MantleStorageAdapter {
  readonly nativeViewDialects = [] as const
  private readonly projectName: string
  private readonly origin: string

  constructor(projectName: string, origin: string) {
    this.projectName = projectName
    this.origin = origin
  }

  async prepare(plan: RuntimePlan): Promise<PreparedMantleStorage> {
    const schemas = new Map<string, SchemaManifest>(
      Object.values(plan.schemas).map((schema) => [schema.name, schema.manifest]),
    )
    const entries = new MemoryEntryRepository(schemas)
    const siteConfig = new MemorySiteConfig(this.projectName, this.origin)
    return {
      entries,
      views: new MemoryViewQueryExecutor(entries, plan),
      localePolicy: siteConfig,
      siteConfig,
    }
  }
}

class MemoryEntryRepository implements EntryRepository, EntryReader {
  private readonly rows = new Map<string, EntryRow>()
  private readonly schemas: ReadonlyMap<string, SchemaManifest>

  constructor(schemas: ReadonlyMap<string, SchemaManifest>) {
    this.schemas = schemas
  }

  async create(args: CreateEntryArgs): Promise<EntryRow> {
    if (this.rows.has(args.id)) throw new EntryUniqueConflict(args.collection, { id: args.id })
    this.assertUniqueIndexes(args.collection, args.data)
    const row: EntryRow = {
      id: args.id,
      collection: args.collection,
      locale: liftLocale(args.data),
      status: args.status,
      version: 1,
      data: structuredClone(args.data),
      authorId: args.authorId,
      createdAt: args.now,
      updatedAt: args.now,
    }
    this.rows.set(row.id, row)
    return structuredClone(row)
  }

  async get(id: string): Promise<EntryRow | null> {
    const row = this.rows.get(id)
    return row ? structuredClone(row) : null
  }

  async update(args: UpdateEntryArgs): Promise<EntryRow> {
    const row = this.rows.get(args.id)
    if (!row) throw new EntryVersionConflict(args.id, args.expectedVersion, -1)
    if (row.version !== args.expectedVersion) throw new EntryVersionConflict(args.id, args.expectedVersion, row.version)
    this.assertUniqueIndexes(row.collection, args.data, row.id)
    const next: EntryRow = {
      ...row,
      locale: liftLocale(args.data),
      data: structuredClone(args.data),
      version: row.version + 1,
      updatedAt: args.now,
    }
    this.rows.set(row.id, next)
    return structuredClone(next)
  }

  async delete(args: DeleteEntryArgs): Promise<{ readonly removed: boolean }> {
    const row = this.rows.get(args.id)
    if (!row || row.collection !== args.collection) return { removed: false }
    if (row.version !== args.expectedVersion) throw new EntryVersionConflict(args.id, args.expectedVersion, row.version)
    if (row.status !== args.expectedStatus) throw new EntryStatusConflict(args.id, args.expectedStatus, row.status)
    return { removed: this.rows.delete(args.id) }
  }

  async transitionStatus(args: TransitionStatusArgs): Promise<EntryRow> {
    const row = this.rows.get(args.id)
    if (!row) throw new EntryStatusConflict(args.id, args.expectedStatus ?? args.to, args.to)
    if (args.expectedVersion !== undefined && row.version !== args.expectedVersion) {
      throw new EntryVersionConflict(args.id, args.expectedVersion, row.version)
    }
    if (args.expectedStatus !== undefined && row.status !== args.expectedStatus) {
      throw new EntryStatusConflict(args.id, args.expectedStatus, row.status)
    }
    const next = { ...row, status: args.to, version: row.version + 1, updatedAt: args.now }
    this.rows.set(row.id, next)
    return structuredClone(next)
  }

  async list(args: ListEntriesArgs): Promise<ListEntriesResult> {
    const limit = clampLimit(args.limit)
    const sort = args.sort ?? { field: 'updatedAt', direction: 'desc' }
    const cursor = decodeEntrySortCursor(args.cursor, sort.field, sort.direction)
    const search = args.search?.toLowerCase()
    const rows = this.allRows(args.collection)
      .filter((row) => !args.status || row.status === args.status)
      .filter((row) => !search || row.id.toLowerCase().includes(search)
        || (args.searchFields ?? []).some((field) => typeof row.data[field] === 'string' && row.data[field].toLowerCase().includes(search)))
      .filter((row) => !args.filter || row.data[args.filter.field] === args.filter.value)
      .sort((left, right) => compareRows(left, right, sort.field, sort.direction))
    const candidates = cursor
      ? rows.filter((row) => {
          const order = compareCursor(row, cursor[0], cursor[1], sort.field, sort.direction)
          return args.cursorDirection === 'backward' ? order < 0 : order > 0
        })
      : rows
    const queried = args.cursorDirection === 'backward' ? [...candidates].reverse() : candidates
    const hasMore = queried.length > limit
    const page = queried.slice(0, limit)
    if (args.cursorDirection === 'backward') page.reverse()
    const first = page[0]
    const last = page.at(-1)
    return {
      rows: structuredClone(page),
      previousCursor: first && (args.cursorDirection === 'backward' ? hasMore : cursor !== null)
        ? encodeEntrySortCursor(sort.field, sort.direction, entrySortValue(first, sort.field), first.id)
        : undefined,
      nextCursor: last && (args.cursorDirection === 'backward' ? cursor !== null : hasMore)
        ? encodeEntrySortCursor(sort.field, sort.direction, entrySortValue(last, sort.field), last.id)
        : undefined,
    }
  }

  async findByDataField(args: FindEntryByDataFieldArgs): Promise<EntryRow | null> {
    return this.findByDataFields({ collection: args.collection, status: args.status, fields: { [args.field]: args.value } })
  }

  async findByDataFields(args: FindEntryByDataFieldsArgs): Promise<EntryRow | null> {
    const fields = Object.entries(args.fields)
    if (fields.length === 0) return null
    const row = this.allRows(args.collection)
      .filter((item) => !args.status || item.status === args.status)
      .filter((item) => !args.excludeId || item.id !== args.excludeId)
      .filter((item) => fields.every(([field, value]) => item.data[field] === value))
      .sort(newestFirst)[0]
    return row ? structuredClone(row) : null
  }

  async readById(id: string): Promise<Entry | null> {
    const row = this.rows.get(id)
    return row ? projectPublicEntry(structuredClone(row)) : null
  }

  async readBySlug(args: ReadEntryBySlugArgs): Promise<Entry | null> {
    return this.readByDataField({ ...args, field: 'slug', value: args.slug })
  }

  async readByDataField(args: ReadEntryByDataFieldArgs): Promise<Entry | null> {
    const row = this.allRows(args.collection)
      .filter((item) => !args.status || item.status === args.status)
      .filter((item) => matchesLocale(item, args.locale))
      .filter((item) => item.data[args.field] === args.value)
      .sort(newestFirst)[0]
    return row ? projectPublicEntry(structuredClone(row)) : null
  }

  async readByDataFieldIn(args: ReadEntriesByDataFieldInArgs): Promise<readonly Entry[]> {
    const values = new Set(args.values)
    return this.allRows(args.collection)
      .filter((item) => !args.status || item.status === args.status)
      .filter((item) => matchesLocale(item, args.locale))
      .filter((item) => {
        const value = item.data[args.field]
        return (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && values.has(value)
      })
      .sort(newestFirst)
      .map((row) => projectPublicEntry(structuredClone(row)))
  }

  async readPublished(args: ReadPublishedEntriesArgs = {}): Promise<readonly Entry[]> {
    return this.allRows(args.collection)
      .filter((item) => item.status === 'published')
      .filter((item) => matchesLocale(item, args.locale))
      .sort(newestFirst)
      .slice(0, args.limit ?? this.rows.size)
      .map((row) => projectPublicEntry(structuredClone(row)))
  }

  async findManyByDataField(args: FindManyEntriesByDataFieldArgs): Promise<readonly Entry[]> {
    return this.allRows(args.collection)
      .filter((item) => item.data[args.field] === args.value)
      .sort(newestFirst)
      .slice(0, args.limit)
      .map((row) => projectPublicEntry(structuredClone(row)))
  }

  allRows(collection?: string): EntryRow[] {
    return [...this.rows.values()].filter((row) => collection === undefined || row.collection === collection)
  }

  private assertUniqueIndexes(collection: string, data: Record<string, unknown>, excludeId?: string): void {
    for (const fields of this.schemas.get(collection)?.spec.uniqueIndexes ?? []) {
      if (fields.some((field) => data[field] == null)) continue
      if (this.allRows(collection).some((row) => row.id !== excludeId && fields.every((field) => row.data[field] === data[field]))) {
        throw new EntryUniqueConflict(collection, Object.fromEntries(fields.map((field) => [field, data[field]])))
      }
    }
  }
}

type PreparedView = Extract<LogicalViewPlan, { readonly kind: 'declarative' }>

class MemoryViewQueryExecutor implements ViewQueryExecutor {
  private readonly views = new Map<string, PreparedView>()
  private readonly entries: MemoryEntryRepository

  constructor(entries: MemoryEntryRepository, plan: RuntimePlan) {
    this.entries = entries
    for (const view of Object.values(plan.views)) {
      if (view.query.kind === 'native') {
        throw new DiagnosticError(runtimeDiagnostic({
          code: 'VIEW_DIALECT_UNSUPPORTED',
          severity: 'error',
          path: `manifest:View/${view.name}#/spec/sql`,
          value: view.query.dialect,
          expected: 'a declarative View',
        }))
      }
      this.views.set(view.name, view.query)
    }
  }

  async execute<R = Record<string, unknown>>(request: ViewQueryRequest): Promise<ViewQueryResult<R>> {
    const view = this.views.get(request.view)
    if (!view) throw new Error(`Unknown View '${request.view}'.`)
    let rows = this.entries.allRows(view.from)
      .filter((row) => !view.filter || matchesFilter(row, view.filter, request.params ?? {}, request.ctxUserId))
      .filter((row) => matchesSearch(row, request.search))
      .filter((row) => (request.filters ?? []).every(({ field, value }) => String(fieldValue(row, field)) === value))
    rows = view.orderBy.length > 0
      ? rows.sort((left, right) => compareOrder(left, right, view.orderBy))
      : rows.sort((left, right) => compareValue(left.id, right.id))
    const page = clampPage(request.page)
    const show = clampShow(request.show, view.limit)
    const selected = rows.slice((page - 1) * show, page * show)
    return {
      rows: selected.map((row) => projectRow(row, view.fields)) as R[],
      page,
      show,
      hasMore: rows.length > page * show,
    }
  }
}

class MemorySiteConfig implements SiteConfigRepository {
  private config: SiteConfig

  constructor(projectName: string, origin: string) {
    this.config = {
      title: projectName,
      description: '',
      origin,
      locales: [],
      canonicalLocale: null,
      brand: projectName,
      icons: DEFAULT_SITE_ICONS,
      media: { purposes: [] },
    }
  }

  async seed(_defaults: SiteDefaults | undefined): Promise<void> {}
  async load(): Promise<SiteConfig> { return structuredClone(this.config) }
  async readLocales(): Promise<readonly string[]> { return this.config.locales }
  async readMediaPurposes(): Promise<readonly MediaPurposePolicy[]> { return this.config.media.purposes }

  async updateEditable(values: UpdateEditableSiteConfigArgs): Promise<void> {
    this.config = { ...this.config, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) }
  }
}

function matchesFilter(row: EntryRow, node: FilterAst, params: Readonly<Record<string, unknown>>, ctxUserId?: string): boolean {
  const comparison = comparisonNode(node)
  if (comparison) {
    const expected = isCtxUserRef(comparison.value)
      ? ctxUserId
      : isParamRef(comparison.value)
        ? params[comparison.value.$param]
        : comparison.value
    if (isCtxUserRef(comparison.value) && !ctxUserId) throw new Error('View filter requires ctx.user.id.')
    if (isParamRef(comparison.value) && expected === undefined) throw new Error(`View filter requires param '${comparison.value.$param}'.`)
    const actual = fieldValue(row, comparison.field)
    if (comparison.op === 'eq') return actual === expected
    const order = compareUnknown(actual, expected)
    if (comparison.op === 'gt') return order > 0
    if (comparison.op === 'gte') return order >= 0
    if (comparison.op === 'lt') return order < 0
    return order <= 0
  }
  if ('and' in node) return node.and.every((child) => matchesFilter(row, child, params, ctxUserId))
  return ('or' in node ? node.or : []).some((child) => matchesFilter(row, child, params, ctxUserId))
}

function comparisonNode(node: FilterAst) {
  if ('eq' in node) return { op: 'eq' as const, ...node.eq }
  if ('gt' in node) return { op: 'gt' as const, ...node.gt }
  if ('gte' in node) return { op: 'gte' as const, ...node.gte }
  if ('lt' in node) return { op: 'lt' as const, ...node.lt }
  if ('lte' in node) return { op: 'lte' as const, ...node.lte }
  return null
}

function matchesSearch(row: EntryRow, search: ViewQueryRequest['search']): boolean {
  const term = search?.term.trim().toLowerCase()
  return !term || !search?.fields.length || search.fields.some((field) => String(fieldValue(row, field) ?? '').toLowerCase().includes(term))
}

function compareOrder(left: EntryRow, right: EntryRow, orderBy: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[]): number {
  for (const order of orderBy) {
    const compared = compareUnknown(fieldValue(left, order.field), fieldValue(right, order.field))
    if (compared !== 0) return order.direction === 'desc' ? -compared : compared
  }
  return compareValue(left.id, right.id)
}

function compareRows(left: EntryRow, right: EntryRow, field: string, direction: 'asc' | 'desc'): number {
  const order = compareUnknown(fieldValue(left, field), fieldValue(right, field)) || compareValue(left.id, right.id)
  return direction === 'asc' ? order : -order
}

function compareCursor(row: EntryRow, value: string | number, id: string, field: string, direction: 'asc' | 'desc'): number {
  const order = compareUnknown(fieldValue(row, field), value) || compareValue(row.id, id)
  return direction === 'asc' ? order : -order
}

function entrySortValue(row: EntryRow, field: string): string | number {
  const value = fieldValue(row, field)
  if (typeof value === 'boolean') return Number(value)
  if (typeof value === 'string' || typeof value === 'number') return value
  throw new Error(`Non-scalar sort value for '${field}'.`)
}

function fieldValue(row: EntryRow, field: string): unknown {
  if (field === 'id') return row.id
  if (field === 'status') return row.status
  if (field === 'version') return row.version
  if (field === 'createdAt') return row.createdAt
  if (field === 'updatedAt') return row.updatedAt
  if (field === 'authorId') return row.authorId
  return row.data[field]
}

function projectRow(row: EntryRow, fields: readonly string[] | undefined): Record<string, unknown> {
  const selected = fields ?? ['id', 'status', 'version', 'createdAt', 'updatedAt', 'authorId']
  return Object.fromEntries(selected.map((field) => [field, structuredClone(fieldValue(row, field))]))
}

function matchesLocale(row: EntryRow, locale: string | null | undefined): boolean {
  return locale === undefined || (locale === null ? row.data.locale == null : row.locale === locale)
}

function newestFirst(left: EntryRow, right: EntryRow): number {
  return right.updatedAt - left.updatedAt || compareValue(right.id, left.id)
}

function compareUnknown(left: unknown, right: unknown): number {
  if (left == null) return right == null ? 0 : -1
  if (right == null) return 1
  if (typeof left === 'boolean' && typeof right === 'boolean') return compareValue(Number(left), Number(right))
  if ((typeof left === 'string' && typeof right === 'string') || (typeof left === 'number' && typeof right === 'number')) {
    return compareValue(left, right)
  }
  return compareValue(String(left), String(right))
}

function compareValue(left: string | number, right: string | number): number {
  return left < right ? -1 : left > right ? 1 : 0
}
