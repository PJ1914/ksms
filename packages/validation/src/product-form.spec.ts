import { buildOpeningStockPayload, buildProductPayload, validateProductForm } from './product-form';

const units = [
  { id: 'u-kg', code: 'KG' },
  { id: 'u-l', code: 'L' },
  { id: 'u-pcs', code: 'PCS' },
];

describe('validateProductForm', () => {
  it('accepts a normal product', () => {
    expect(
      validateProductForm({ name: 'Sona Masoori Rice', sellBy: 'KG', price: '52.50' }),
    ).toBeNull();
  });

  it.each([
    ['', '52', 'name'],
    [' A ', '52', 'name'],
    ['Rice', '', 'price'],
    ['Rice', 'abc', 'price'],
    ['Rice', '-5', 'price'],
    ['Rice', '52.505', 'price'],
    ['Rice', '1e3', 'price'],
  ])('rejects name=%j price=%j (%s)', (name, price, what) => {
    const msg = validateProductForm({ name, sellBy: 'KG', price });
    expect(msg).toMatch(what === 'name' ? /name/i : /price/i);
  });
});

describe('buildProductPayload', () => {
  it('sends the price as a decimal string for one base unit', () => {
    const body = buildProductPayload({ name: '  Sugar ', sellBy: 'KG', price: ' 45.5 ' }, units);
    expect(body).toEqual({
      name: 'Sugar',
      type: 'WEIGHT',
      baseUnitId: 'u-kg',
      prices: [{ unitId: 'u-kg', price: '45.5' }],
    });
    expect(typeof body.prices[0]!.price).toBe('string');
  });

  it('maps litre and piece products to the right type and unit', () => {
    expect(buildProductPayload({ name: 'Oil', sellBy: 'L', price: '180' }, units)).toMatchObject({
      type: 'VOLUME',
      baseUnitId: 'u-l',
    });
    expect(buildProductPayload({ name: 'Soap', sellBy: 'PCS', price: '35' }, units)).toMatchObject({
      type: 'COUNT',
      baseUnitId: 'u-pcs',
    });
  });

  it('includes GST fields when taxable or HSN is provided', () => {
    expect(
      validateProductForm({
        name: 'Rice',
        sellBy: 'KG',
        price: '55',
        isTaxable: true,
        gstRatePercent: '5',
        hsnCode: '1006',
      }),
    ).toBeNull();
    expect(
      buildProductPayload(
        {
          name: 'Rice',
          sellBy: 'KG',
          price: '55',
          isTaxable: true,
          gstRatePercent: '5',
          hsnCode: '1006',
        },
        units,
      ),
    ).toEqual({
      name: 'Rice',
      type: 'WEIGHT',
      baseUnitId: 'u-kg',
      prices: [{ unitId: 'u-kg', price: '55' }],
      isTaxable: true,
      gstRatePercent: '5',
      hsnCode: '1006',
    });
    expect(validateProductForm({ name: 'Rice', sellBy: 'KG', price: '55', hsnCode: '12' })).toMatch(
      /HSN/i,
    );
    expect(
      validateProductForm({
        name: 'Rice',
        sellBy: 'KG',
        price: '55',
        isTaxable: true,
        gstRatePercent: '',
      }),
    ).toMatch(/GST rate/i);
  });

  it('validates and includes optional barcode and MRP', () => {
    expect(
      validateProductForm({
        name: 'Parle-G',
        sellBy: 'PCS',
        price: '10',
        mrp: '10.00',
        barcode: '8901719100017',
      }),
    ).toBeNull();
    expect(
      buildProductPayload(
        {
          name: 'Parle-G',
          sellBy: 'PCS',
          price: '10',
          mrp: '10.00',
          barcode: ' 8901719100017 ',
        },
        units,
      ),
    ).toEqual({
      name: 'Parle-G',
      type: 'COUNT',
      baseUnitId: 'u-pcs',
      prices: [{ unitId: 'u-pcs', price: '10' }],
      mrp: '10.00',
      barcodes: ['8901719100017'],
    });
    expect(
      validateProductForm({ name: 'Parle-G', sellBy: 'PCS', price: '10', mrp: 'bad' }),
    ).toMatch(/MRP/i);
    expect(
      validateProductForm({ name: 'Parle-G', sellBy: 'PCS', price: '10', barcode: '12' }),
    ).toMatch(/Barcode/i);
  });

  it('validates and builds optional opening stock with optional cost (defaults to 0)', () => {
    expect(
      validateProductForm({
        name: 'Parle-G',
        sellBy: 'PCS',
        price: '10',
        openingQuantity: '24',
      }),
    ).toBeNull();
    expect(
      validateProductForm({
        name: 'Parle-G',
        sellBy: 'PCS',
        price: '10',
        openingQuantity: '0',
      }),
    ).toMatch(/Opening stock/i);
    expect(
      validateProductForm({
        name: 'Parle-G',
        sellBy: 'PCS',
        price: '10',
        openingQuantity: '10',
        openingCost: 'bad',
      }),
    ).toMatch(/Cost price/i);

    expect(
      buildOpeningStockPayload('p-1', 'u-pcs', { openingQuantity: '', openingCost: '' }),
    ).toBeNull();
    expect(
      buildOpeningStockPayload('p-1', 'u-pcs', { openingQuantity: ' 24 ', openingCost: '' }),
    ).toEqual({
      productId: 'p-1',
      unitId: 'u-pcs',
      quantity: '24',
      unitCost: '0',
    });
    expect(
      buildOpeningStockPayload('p-1', 'u-pcs', { openingQuantity: '24', openingCost: '8.50' }),
    ).toEqual({
      productId: 'p-1',
      unitId: 'u-pcs',
      quantity: '24',
      unitCost: '8.50',
    });
  });

  it('fails clearly if the server has no such unit', () => {
    expect(() => buildProductPayload({ name: 'Oil', sellBy: 'L', price: '1' }, [])).toThrow(/L/);
  });
});
