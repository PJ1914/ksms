/* eslint-disable @typescript-eslint/no-require-imports -- React Native bundles static images through require() */
/**
 * Illustrations and icons (Fresh Mandi art set). Files are produced by asset-pipeline/build_assets.py;
 * React Native picks the @2x / @3x file for the screen density automatically.
 */
import type { ImageSourcePropType } from 'react-native';

export const illustrations = {
  appIcon: require('../../assets/illustrations/s01-01-app-icon.png'),
  shopkeeper: require('../../assets/illustrations/s01-02-splash-shopkeeper.png'),
  shopfront: require('../../assets/illustrations/s01-03-login-shopfront.png'),
  basket: require('../../assets/illustrations/s01-04-home-basket.png'),
  ledger: require('../../assets/illustrations/s01-05-khata-ledger.png'),
  billSaved: require('../../assets/illustrations/s01-06-bill-saved.png'),
  sync: require('../../assets/illustrations/s02-01-sync-backup.png'),
  dailyClosing: require('../../assets/illustrations/s02-02-daily-closing.png'),
  reports: require('../../assets/illustrations/s02-03-reports-board.png'),
  supplierTruck: require('../../assets/illustrations/s02-04-supplier-truck.png'),
  collectionAgent: require('../../assets/illustrations/s02-05-collection-agent.png'),
  offline: require('../../assets/illustrations/s02-06-offline-ok.png'),
  emptyBills: require('../../assets/illustrations/s03-01-empty-bills.png'),
  emptyCart: require('../../assets/illustrations/s03-02-empty-cart.png'),
  emptyProducts: require('../../assets/illustrations/s03-03-empty-products.png'),
  emptyCustomers: require('../../assets/illustrations/s03-04-empty-customers.png'),
  emptyKhata: require('../../assets/illustrations/s03-05-empty-khata.png'),
  emptySearch: require('../../assets/illustrations/s03-06-empty-search.png'),
  emptyExpiring: require('../../assets/illustrations/s04-01-empty-expiring.png'),
  emptyNotifications: require('../../assets/illustrations/s04-02-empty-notifications.png'),
  emptyHeld: require('../../assets/illustrations/s04-03-empty-held.png'),
  emptyPurchases: require('../../assets/illustrations/s04-04-empty-purchases.png'),
  emptySuppliers: require('../../assets/illustrations/s04-05-empty-suppliers.png'),
  emptyExpenses: require('../../assets/illustrations/s04-06-empty-expenses.png'),
  emptyCollections: require('../../assets/illustrations/s05-01-empty-collections.png'),
  emptyMovement: require('../../assets/illustrations/s05-02-empty-movement.png'),
  error: require('../../assets/illustrations/s05-03-error.png'),
  roleLocked: require('../../assets/illustrations/s05-04-role-locked.png'),
  cameraPermission: require('../../assets/illustrations/s05-05-camera-permission.png'),
  duesCleared: require('../../assets/illustrations/s05-06-dues-cleared.png'),
} satisfies Record<string, ImageSourcePropType>;

export const icons = {
  catAtta: require('../../assets/icons/s06-01-cat-atta.png'),
  catRice: require('../../assets/icons/s06-02-cat-rice.png'),
  catDal: require('../../assets/icons/s06-03-cat-dal.png'),
  catOil: require('../../assets/icons/s06-04-cat-oil-ghee.png'),
  catSugarSalt: require('../../assets/icons/s06-05-cat-sugar-salt.png'),
  catSpices: require('../../assets/icons/s06-06-cat-spices.png'),
  catDairy: require('../../assets/icons/s07-01-cat-dairy.png'),
  catEggsBread: require('../../assets/icons/s07-02-cat-eggs-bread.png'),
  catTea: require('../../assets/icons/s07-03-cat-tea-coffee.png'),
  catDrinks: require('../../assets/icons/s07-04-cat-drinks.png'),
  catSnacks: require('../../assets/icons/s07-05-cat-snacks.png'),
  catBiscuits: require('../../assets/icons/s07-06-cat-biscuits.png'),
  catFruitsVeg: require('../../assets/icons/s08-01-cat-fruits-veg.png'),
  catPersonalCare: require('../../assets/icons/s08-02-cat-personal-care.png'),
  catCleaning: require('../../assets/icons/s08-03-cat-cleaning.png'),
  catBaby: require('../../assets/icons/s08-04-cat-baby.png'),
  catPooja: require('../../assets/icons/s08-05-cat-pooja.png'),
  catOther: require('../../assets/icons/s08-06-cat-other.png'),
  payCash: require('../../assets/icons/s09-01-pay-cash.png'),
  payUpi: require('../../assets/icons/s09-02-pay-upi.png'),
  payCard: require('../../assets/icons/s09-03-pay-card.png'),
  payKhata: require('../../assets/icons/s09-04-pay-khata.png'),
  paySplit: require('../../assets/icons/s09-05-pay-split.png'),
  payReceived: require('../../assets/icons/s09-06-pay-received.png'),
  lowStock: require('../../assets/icons/s10-01-alert-low-stock.png'),
  expiring: require('../../assets/icons/s10-02-alert-expiring.png'),
  overLimit: require('../../assets/icons/s10-03-alert-over-limit.png'),
  overdue: require('../../assets/icons/s10-04-alert-overdue.png'),
  reminder: require('../../assets/icons/s10-05-reminder.png'),
  notification: require('../../assets/icons/s10-06-notification.png'),
  scan: require('../../assets/icons/s11-01-act-scan.png'),
  print: require('../../assets/icons/s11-02-act-print.png'),
  gstInvoice: require('../../assets/icons/s11-03-act-gst-invoice.png'),
  hold: require('../../assets/icons/s11-04-act-hold.png'),
  returns: require('../../assets/icons/s11-05-act-return.png'),
  stockAdjust: require('../../assets/icons/s11-06-act-stock-adjust.png'),
  repSales: require('../../assets/icons/s12-01-rep-sales.png'),
  repProfit: require('../../assets/icons/s12-02-rep-profit.png'),
  repCash: require('../../assets/icons/s12-03-rep-cashflow.png'),
  repDues: require('../../assets/icons/s12-04-rep-dues.png'),
  repStock: require('../../assets/icons/s12-05-rep-stock.png'),
  repCollections: require('../../assets/icons/s12-06-rep-collections.png'),
  repPurchases: require('../../assets/icons/s13-01-rep-purchases.png'),
  repDayBook: require('../../assets/icons/s13-02-rep-daybook.png'),
  roleOwner: require('../../assets/icons/s13-03-role-owner.png'),
  roleManager: require('../../assets/icons/s13-04-role-manager.png'),
  roleCashier: require('../../assets/icons/s13-05-role-cashier.png'),
  roleAgent: require('../../assets/icons/s13-06-role-agent.png'),
  expenses: require('../../assets/icons/s14-01-feat-expenses.png'),
  cashbook: require('../../assets/icons/s14-02-feat-cashbook.png'),
  categories: require('../../assets/icons/s14-03-feat-categories.png'),
  addCustomer: require('../../assets/icons/s14-04-feat-add-customer.png'),
  addSupplier: require('../../assets/icons/s14-05-feat-add-supplier.png'),
  addProduct: require('../../assets/icons/s14-06-feat-add-product.png'),
} satisfies Record<string, ImageSourcePropType>;

export type IllustrationName = keyof typeof illustrations;
export type IconArtName = keyof typeof icons;

/** Best-guess art for a product category name (falls back to the generic box). */
export function categoryArt(name: string | null | undefined): ImageSourcePropType {
  const n = (name ?? '').toLowerCase();
  const rules: [RegExp, IconArtName][] = [
    [/atta|flour|maida|sooji|besan|wheat/, 'catAtta'],
    [/rice|chawal|poha/, 'catRice'],
    [/dal|pulse|lentil|chana|rajma/, 'catDal'],
    [/oil|ghee/, 'catOil'],
    [/sugar|salt|jaggery|gud/, 'catSugarSalt'],
    [/spice|masala|haldi|chilli|mirch/, 'catSpices'],
    [/milk|dairy|curd|paneer|butter|cheese/, 'catDairy'],
    [/egg|bread|bakery/, 'catEggsBread'],
    [/tea|coffee|chai/, 'catTea'],
    [/drink|juice|beverage|soda|water/, 'catDrinks'],
    [/snack|namkeen|chips/, 'catSnacks'],
    [/biscuit|cookie/, 'catBiscuits'],
    [/fruit|veg|sabzi/, 'catFruitsVeg'],
    [/soap|shampoo|personal|care|paste|cosmetic/, 'catPersonalCare'],
    [/clean|detergent|wash/, 'catCleaning'],
    [/baby|diaper/, 'catBaby'],
    [/pooja|puja|agarbatti|incense/, 'catPooja'],
  ];
  for (const [re, key] of rules) if (re.test(n)) return icons[key];
  return icons.catOther;
}

/** Yapaaram icon in layers, for the opening animation (made by assets/brand/make-intro-layers.py). */
export const brand = {
  awning: require('../../assets/brand/intro-awning.png'),
  body: require('../../assets/brand/intro-body.png'),
  rupee: require('../../assets/brand/intro-rupee.png'),
};
