import { inferCategory } from './auto-category';

describe('inferCategory', () => {
  it.each([
    ['Santoor Sandal Soap 100g', 'Bath Soaps'],
    ['Lifebuoy Handwash Refill', 'Bath Soaps'],
    ['Surf Excel Easy Wash 1kg', 'Detergents & Surf'],
    ['Vim Dishwash Bar', 'Detergents & Surf'],
    ['Knorr Tomato Soup', 'Soups & Noodles'],
    ['Maggi 2-Minute Noodles', 'Soups & Noodles'],
    ['Sona Masoori Rice 25kg', 'Rice & Grains'],
    ['Toor Dal 1kg', 'Dal & Pulses'],
    ['Freedom Sunflower Oil 1L', 'Oils & Ghee'],
    ['Parachute Coconut Hair Oil', 'Personal Care'],
    ['Colgate Strong Teeth Paste', 'Personal Care'],
    ['Parle-G Gold Biscuits', 'Snacks & Biscuits'],
    ['Cadbury Dairy Milk', 'Snacks & Biscuits'],
    ['Amul Taaza Milk 500ml', 'Dairy'],
    ['Red Label Tea 250g', 'Beverages'],
    ['Everest Garam Masala', 'Spices & Masala'],
    ['Good Knight Liquid Refill', 'Household'],
  ])('classifies %j into %j', (name, expected) => {
    expect(inferCategory(name)?.categoryName).toBe(expected);
  });

  it('matches custom shop categories when no built-in rule applies', () => {
    const res = inferCategory('Classmate Stationery Notebook', null, [
      { id: 'c-1', name: 'Stationery' },
    ]);
    expect(res).toEqual({ categoryId: 'c-1', categoryName: 'Stationery' });
  });

  it('returns null for unrecognized items instead of misclassifying', () => {
    expect(inferCategory('Mystery Widget XYZ')).toBeNull();
  });
});
