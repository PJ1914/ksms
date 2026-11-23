import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  type Cart,
  type CartLine,
  type IdempotencyHandle,
  addToCart,
  emptyCart,
  removeLine,
  setBillDiscount,
  setCustomer,
  updateLine,
} from '@ksms/validation';
import { newKey } from '@/api/client';
import { clearDraftBill, loadDraftBill, saveDraftBill } from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';

type Action =
  | { type: 'add'; line: Parameters<typeof addToCart>[1] }
  | { type: 'update'; key: string; patch: Parameters<typeof updateLine>[2] }
  | { type: 'remove'; key: string }
  | { type: 'customer'; id: string | null; name: string | null }
  | { type: 'billDiscount'; value: string }
  | { type: 'load'; cart: Cart }
  | { type: 'clear' };

function reducer(cart: Cart, a: Action): Cart {
  switch (a.type) {
    case 'add':
      return addToCart(cart, a.line, newKey);
    case 'update':
      return updateLine(cart, a.key, a.patch);
    case 'remove':
      return removeLine(cart, a.key);
    case 'customer':
      return setCustomer(cart, a.id, a.name);
    case 'billDiscount':
      return setBillDiscount(cart, a.value);
    case 'load':
      return a.cart;
    case 'clear':
      return emptyCart();
  }
}

interface CartApi {
  cart: Cart;
  add: (line: Parameters<typeof addToCart>[1]) => void;
  update: (
    key: string,
    patch: Partial<Pick<CartLine, 'quantity' | 'discount' | 'unitPrice'>>,
  ) => void;
  remove: (key: string) => void;
  setCustomer: (id: string | null, name: string | null) => void;
  setBillDiscount: (value: string) => void;
  load: (cart: Cart) => void;
  clear: () => void;
  /** The idempotency key of the checkout in progress (kept while the cart is unchanged, so a retry cannot sell twice). */
  checkoutKey: React.MutableRefObject<IdempotencyHandle | null>;
}

const CartContext = createContext<CartApi | null>(null);

/** The bill being rung up. Persisted locally in SQLite as a draft bill per (org, user, branch). */
export function CartProvider({
  scopeKey,
  children,
}: {
  scopeKey?: string | null;
  children: React.ReactNode;
}) {
  const { db, ready } = useSync();
  const [cart, dispatch] = useReducer(reducer, undefined, emptyCart);
  const checkoutKey = useRef<IdempotencyHandle | null>(null);
  const hydrated = useRef(false);

  // Restore any unfinished draft bill for this (org, user, branch) once the local cache is ready.
  useEffect(() => {
    hydrated.current = false;
    if (!ready || !db || !scopeKey) return;
    let cancelled = false;
    void loadDraftBill(db, scopeKey).then((saved) => {
      if (cancelled) return;
      hydrated.current = true;
      if (saved && (saved.lines.length > 0 || saved.customerId !== null)) {
        dispatch({ type: 'load', cart: saved });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, db, scopeKey]);

  // Persist every cart edit as a local draft bill in SQLite.
  useEffect(() => {
    if (!ready || !db || !scopeKey || !hydrated.current) return;
    void saveDraftBill(db, scopeKey, cart).catch(() => undefined);
  }, [ready, db, scopeKey, cart]);

  const clear = useCallback(() => {
    checkoutKey.current = null;
    dispatch({ type: 'clear' });
    if (db && scopeKey) {
      void clearDraftBill(db, scopeKey).catch(() => undefined);
    }
  }, [db, scopeKey]);

  const value = useMemo<CartApi>(
    () => ({
      cart,
      add: (line) => dispatch({ type: 'add', line }),
      update: (key, patch) => dispatch({ type: 'update', key, patch }),
      remove: (key) => dispatch({ type: 'remove', key }),
      setCustomer: (id, name) => dispatch({ type: 'customer', id, name }),
      setBillDiscount: (v) => dispatch({ type: 'billDiscount', value: v }),
      load: (c) => {
        checkoutKey.current = null;
        dispatch({ type: 'load', cart: c });
      },
      clear,
      checkoutKey,
    }),
    [cart, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
