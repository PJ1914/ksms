/** Return this from a controller to get `{ data: items, meta: { page, pageSize, total } }`. */
export class Paginated<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: { page: number; pageSize: number; total: number },
  ) {}
}
