import { getData } from '@/api/client';
import type { SupplierRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Select } from '@/components/Select';
import { useLoad } from '@/hooks/useLoad';

/** Optional "which supplier did this come from" drop-down. Hidden when the user cannot see suppliers. */
export function SupplierPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { can } = useAuth();
  const allowed = can('supplier.read');
  const list = useLoad(
    () =>
      allowed
        ? getData<SupplierRow[]>('/suppliers?isActive=true&pageSize=100&sort=name&order=asc')
        : Promise.resolve([] as SupplierRow[]),
    [allowed],
  );
  if (!allowed || (list.data ?? []).length === 0) return null;
  return (
    <Select
      label="Supplier (optional)"
      options={[
        { key: '', label: 'No supplier' },
        ...(list.data ?? []).map((s) => ({ key: s.id, label: s.name })),
      ]}
      value={value}
      onChange={onChange}
      hint="Noted on the supplier. No money is added to what you owe them."
    />
  );
}
