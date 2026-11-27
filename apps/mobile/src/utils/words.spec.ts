import { rupeesInWords } from './words';

describe('rupeesInWords', () => {
  it.each([
    ['0', 'Rupees Zero Only'],
    ['295', 'Rupees Two Hundred Ninety Five Only'],
    ['1234.50', 'Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only'],
    ['100000', 'Rupees One Lakh Only'],
    [
      '12345678',
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
    ],
  ])('%s', (amount, words) => {
    expect(rupeesInWords(amount)).toBe(words);
  });
});
