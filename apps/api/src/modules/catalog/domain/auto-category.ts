/**
 * Pure Indian-Kirana product auto-categorizer.
 *
 * Matches a product's name (and optional local name) against:
 * 1. The shop's own existing category names (so custom categories work automatically), then
 * 2. Built-in Kirana category rules (brand + product keywords).
 *
 * Returns null if no rule matches so unrecognized items stay uncategorized rather than misclassified.
 */

export interface ExistingCategory {
  id: string;
  name: string;
}

export interface CategorySuggestion {
  /** Present when matched directly to one of the shop's existing categories. */
  categoryId?: string;
  categoryName: string;
}

interface CategoryRule {
  category: string;
  keywords: readonly string[];
  exclude?: readonly string[];
}

const RULES: readonly CategoryRule[] = [
  {
    category: 'Bath Soaps',
    keywords: [
      'bath soap',
      'soap',
      'santoor',
      'lux',
      'lifebuoy',
      'dettol',
      'cinthol',
      'pears',
      'medimix',
      'mysore sandal',
      'hamam',
      'rexona',
      'fiama',
      'liril',
      'body wash',
      'handwash',
      'hand wash',
      'dove soap',
      'dove bar',
    ],
    exclude: ['washing soap', 'detergent', 'dishwash', 'dish wash'],
  },
  {
    category: 'Detergents & Surf',
    keywords: [
      'surf',
      'rin',
      'tide',
      'ariel',
      'wheel',
      'ghadi',
      'nirma',
      'henko',
      'detergent',
      'washing powder',
      'washing soap',
      'washing bar',
      'vim',
      'pril',
      'exo',
      'dishwash',
      'dish wash',
      'harpic',
      'lizol',
      'comfort',
      'ujala',
      'fabric softener',
      'bleach',
      'phenyl',
      'floor cleaner',
      'toilet cleaner',
    ],
  },
  {
    category: 'Soups & Noodles',
    keywords: [
      'soup',
      'knorr',
      'ching',
      'maggi',
      'yippee',
      'noodles',
      'noodle',
      'pasta',
      'macaroni',
      'vermicelli',
      'semiya',
      'top ramen',
      'hakka',
    ],
  },
  {
    category: 'Personal Care',
    keywords: [
      'shampoo',
      'conditioner',
      'toothpaste',
      'tooth paste',
      'toothbrush',
      'colgate',
      'pepsodent',
      'close up',
      'closeup',
      'sensodyne',
      'dabur red',
      'clinic plus',
      'head & shoulders',
      'pantene',
      'sunsilk',
      'hair oil',
      'parachute',
      'navratna',
      'talc',
      'ponds',
      'vaseline',
      'lotion',
      'face wash',
      'facewash',
      'cream',
      'deodorant',
      'perfume',
      'fogg',
      'razor',
      'blade',
      'gillette',
      'sanitary',
      'whisper',
      'stayfree',
      'diaper',
      'pampers',
      'huggies',
    ],
    exclude: ['ice cream', 'fresh cream', 'biscuit'],
  },
  {
    category: 'Oils & Ghee',
    keywords: [
      'sunflower oil',
      'groundnut oil',
      'mustard oil',
      'coconut oil',
      'palm oil',
      'cooking oil',
      'refined oil',
      'rice bran',
      'oil',
      'ghee',
      'vanaspati',
      'dalda',
      'fortune',
      'freedom',
      'gold drop',
      'saffola',
      'dhara',
    ],
    exclude: ['hair oil', 'baby oil', 'massage oil', 'lamp oil'],
  },
  {
    category: 'Rice & Grains',
    keywords: [
      'rice',
      'sona masoori',
      'basmati',
      'kolam',
      'poha',
      'rava',
      'suji',
      'sooji',
      'atta',
      'maida',
      'besan',
      'wheat',
      'flour',
      'jowar',
      'bajra',
      'ragi',
      'millet',
      'oats',
      'dalia',
      'sago',
      'sabudana',
    ],
  },
  {
    category: 'Dal & Pulses',
    keywords: [
      'dal',
      'daal',
      'toor',
      'tuvar',
      'moong',
      'masoor',
      'urad',
      'chana',
      'rajma',
      'kabuli',
      'chole',
      'lentil',
      'pulses',
      'groundnut',
      'peanut',
      'soya',
      'beans',
    ],
  },
  {
    category: 'Spices & Masala',
    keywords: [
      'masala',
      'salt',
      'sugar',
      'jaggery',
      'bellam',
      'turmeric',
      'haldi',
      'chilli',
      'mirchi',
      'jeera',
      'cumin',
      'coriander',
      'dhaniya',
      'pepper',
      'cardamom',
      'elaichi',
      'clove',
      'cinnamon',
      'hing',
      'asafoetida',
      'tamarind',
      'pickle',
      'achar',
      'everest',
      'mdh',
      'mtr',
      'aachi',
      'catch',
      'ketchup',
      'sauce',
      'vinegar',
    ],
  },
  {
    category: 'Snacks & Biscuits',
    keywords: [
      'biscuit',
      'cookies',
      'cookie',
      'parle',
      'britannia',
      'good day',
      'marie',
      'bourbon',
      'oreo',
      'hide & seek',
      'krackjack',
      'monaco',
      'tiger',
      'chips',
      'lays',
      'kurkure',
      'bingo',
      'haldiram',
      'namkeen',
      'mixture',
      'bhujia',
      'chocolate',
      'dairy milk',
      'kitkat',
      '5 star',
      'munch',
      'perk',
      'candy',
      'toffee',
      'cake',
      'rusk',
      'bread',
      'bun',
      'popcorn',
    ],
  },
  {
    category: 'Beverages',
    keywords: [
      'tea',
      'chai',
      'coffee',
      'bru',
      'nescafe',
      'red label',
      'taj mahal',
      '3 roses',
      'boost',
      'horlicks',
      'bournvita',
      'complan',
      'juice',
      'maaza',
      'frooti',
      'slice',
      'coke',
      'coca cola',
      'pepsi',
      'sprite',
      'thums up',
      'limca',
      'mirinda',
      'fanta',
      '7up',
      'soda',
      'water',
      'bisleri',
      'kinley',
      'sting',
      'red bull',
      'sharbat',
      'rooh afza',
    ],
  },
  {
    category: 'Dairy',
    keywords: [
      'milk',
      'curd',
      'dahi',
      'paneer',
      'cheese',
      'butter',
      'buttermilk',
      'lassi',
      'amul',
      'heritage',
      'vijaya',
      'nandini',
      'aavin',
      'dodla',
      'jersey',
      'ice cream',
      'fresh cream',
      'condensed milk',
    ],
    exclude: ['dairy milk'],
  },
  {
    category: 'Household',
    keywords: [
      'agarbatti',
      'incense',
      'dhoop',
      'camphor',
      'kapoor',
      'matchbox',
      'matches',
      'candle',
      'mosquito',
      'good knight',
      'all out',
      'mortein',
      'hit',
      'odonil',
      'broom',
      'mop',
      'scrubber',
      'scotch brite',
      'foil',
      'tissue',
      'napkin',
      'battery',
      'duracell',
      'eveready',
      'bulb',
      'led',
    ],
  },
];

function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim()} `;
}

function hasPhrase(haystack: string, phrase: string): boolean {
  const clean = phrase.toLowerCase().trim();
  if (!clean) return false;
  return haystack.includes(` ${clean} `) || haystack.includes(` ${clean}s `);
}

export function inferCategory(
  name: string,
  localName?: string | null,
  existingCategories: readonly ExistingCategory[] = [],
): CategorySuggestion | null {
  const haystack = normalize(`${name} ${localName ?? ''}`);

  // 1. Check built-in rules first (they have exact exclusions like "hair oil" vs "oil" and "dairy milk" vs "milk").
  for (const rule of RULES) {
    if (rule.exclude?.some((ex) => hasPhrase(haystack, ex))) continue;
    if (rule.keywords.some((kw) => hasPhrase(haystack, kw))) {
      const existing = existingCategories.find(
        (c) => c.name.toLowerCase() === rule.category.toLowerCase(),
      );
      return { categoryId: existing?.id, categoryName: existing?.name ?? rule.category };
    }
  }

  // 2. Fallback: match against any custom shop category name (e.g. "Stationery" -> "Nataraj Stationery Set").
  for (const cat of existingCategories) {
    const cleanName = cat.name.trim().toLowerCase();
    if (cleanName.length < 3) continue;
    const singular =
      cleanName.endsWith('s') && cleanName.length > 4 ? cleanName.slice(0, -1) : cleanName;
    if (hasPhrase(haystack, cleanName) || hasPhrase(haystack, singular)) {
      return { categoryId: cat.id, categoryName: cat.name };
    }
  }

  return null;
}
