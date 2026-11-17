/**
 * Return this from a controller to get `{ data: items, meta: { page, pageSize, total, ...extra } }`.
 * `extra` carries list-wide facts that belong next to the page (e.g. a supplier's current balance).
 */
export class Paginated<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: { page: number; pageSize: number; total: number } & Record<
      string,
      unknown
    >,
  ) {}
}
