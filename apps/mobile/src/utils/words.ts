const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${h ? `${ONES[h]} Hundred${rest ? ' ' : ''}` : ''}${rest ? below100(rest) : ''}`;
}

/** Whole number as Indian-style words (lakh, crore). Handles 0 to 99,99,99,999. */
function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${below100(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** "1234.50" -> "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only". Takes the decimal string. */
export function rupeesInWords(amount: string): string {
  const [whole = '0', frac = ''] = amount.replace('-', '').split('.');
  const rupees = Number(whole.slice(-9) || '0');
  const paise = Number((frac + '00').slice(0, 2));
  const r = `Rupees ${indianWords(rupees)}`;
  return `${r}${paise ? ` and ${below100(paise)} Paise` : ''} Only`;
}
