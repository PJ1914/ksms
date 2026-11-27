// Web only: print just the element with id "invoice-print".
export const canPrint = true;
export function printPage(): void {
  window.print();
}
if (typeof document !== 'undefined' && !document.getElementById('ksms-print')) {
  const style = document.createElement('style');
  style.id = 'ksms-print';
  style.textContent =
    '@media print{body *{visibility:hidden!important}#invoice-print,#invoice-print *{visibility:visible!important}' +
    '#invoice-print{position:absolute!important;left:0;top:0;width:100%!important;max-width:none!important;border:0!important;box-shadow:none!important}' +
    '@page{margin:12mm}}';
  document.head.appendChild(style);
}
