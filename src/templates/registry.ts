import type { CategoryDef, FieldDef, TemplateDef } from './types';

/**
 * The template catalogue, defined in code rather than the database.
 *
 * Each entry pairs with a page in the web app at /templates/{id}. Flip `live`
 * only after that page is deployed — the feed must never advertise a template
 * that 404s.
 */

export const CATEGORIES: CategoryDef[] = [
  { id: 'birthday', name: 'Birthday', emoji: '🎂', displayOrder: 1, live: true },
  { id: 'wedding', name: 'Wedding', emoji: '💍', displayOrder: 2, live: true },
  { id: 'love', name: 'Love', emoji: '💕', displayOrder: 3, live: true },
  { id: 'anniversary', name: 'Anniversary', emoji: '💐', displayOrder: 4, live: true },
  { id: 'friendship', name: 'Friendship', emoji: '👫', displayOrder: 5, live: true },
  { id: 'greeting', name: 'Greeting', emoji: '💌', displayOrder: 6, live: true },
];

/** Repeating {title, text, image} block — the memory-timeline shape. */
const memoryGroupFields: FieldDef[] = [
  { key: 'title', type: 'text', label: 'Moment', required: true, maxLength: 60 },
  { key: 'text', type: 'longText', label: 'What happened', required: true, maxLength: 300 },
  { key: 'image', type: 'image', label: 'Photo', required: false, aspectRatio: '4:5' },
];

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'birthday_for_babies',
    categoryId: 'birthday',
    name: 'Birthday for Babies',
    tagline: 'A soft, playful first-birthday page',
    description:
      'Pastel balloons, a floating photo gallery and a big age reveal — made for the littlest birthdays.',
    thumbnailUrl: '/templates/birthday_for_babies/thumb.webp',
    previewImages: [
      '/templates/birthday_for_babies/p1.webp',
      '/templates/birthday_for_babies/p2.webp',
    ],
    tierKey: 'B',
    live: true,
    displayOrder: 1,
    tags: ['baby', 'first birthday', 'pastel', 'photos'],
    supportsRsvp: false,
    og: {
      title: '{babyName} turns {age}!',
      description: 'A little birthday page, made just for them.',
    },
    fields: [
      { key: 'babyName', type: 'text', label: 'Baby name', required: true, maxLength: 40 },
      { key: 'age', type: 'number', label: 'Turning', required: true, min: 1, max: 12 },
      { key: 'birthdayDate', type: 'date', label: 'Birthday', required: true },
      {
        key: 'photos',
        type: 'imageList',
        label: 'Photos',
        helpText: 'Pick four favourites',
        required: true,
        minItems: 4,
        maxItems: 4,
        aspectRatio: '1:1',
      },
      {
        key: 'message',
        type: 'longText',
        label: 'Your wish',
        required: true,
        maxLength: 400,
        placeholder: 'Happy first birthday, little one...',
      },
    ],
    sampleData: {
      babyName: 'Aarav',
      age: 1,
      birthdayDate: '2026-09-14',
      photos: [
        { full: '/samples/baby-1.webp', thumb: '/samples/baby-1-t.webp', width: 1200, height: 1200 },
        { full: '/samples/baby-2.webp', thumb: '/samples/baby-2-t.webp', width: 1200, height: 1200 },
        { full: '/samples/baby-3.webp', thumb: '/samples/baby-3-t.webp', width: 1200, height: 1200 },
        { full: '/samples/baby-4.webp', thumb: '/samples/baby-4-t.webp', width: 1200, height: 1200 },
      ],
      message: 'One whole year of you. Thank you for making everything brighter.',
    },
  },
  {
    id: 'birthday_gift_reveal',
    categoryId: 'birthday',
    name: 'Open the Surprise',
    tagline: 'A gift box they tap to unwrap',
    description:
      'The page opens as a wrapped box. Tapping it bursts into confetti and reveals your message and photos.',
    thumbnailUrl: '/templates/birthday_gift_reveal/thumb.webp',
    previewImages: ['/templates/birthday_gift_reveal/p1.webp'],
    tierKey: 'A',
    live: true,
    displayOrder: 2,
    tags: ['surprise', 'confetti', 'interactive'],
    supportsRsvp: false,
    og: {
      title: 'A surprise for {recipientName}',
      description: 'Someone made something for you. Tap to open it.',
    },
    fields: [
      { key: 'recipientName', type: 'text', label: 'Their name', required: true, maxLength: 40 },
      { key: 'age', type: 'number', label: 'Turning', required: false, min: 1, max: 120 },
      { key: 'message', type: 'longText', label: 'Message inside', required: true, maxLength: 600 },
      {
        key: 'photos',
        type: 'imageList',
        label: 'Photos',
        required: false,
        minItems: 0,
        maxItems: 6,
        aspectRatio: '4:5',
      },
      {
        key: 'accent',
        type: 'choice',
        label: 'Ribbon colour',
        required: false,
        defaultValue: 'blush',
        options: [
          { value: 'blush', label: 'Blush' },
          { value: 'gold', label: 'Gold' },
          { value: 'midnight', label: 'Midnight' },
        ],
      },
    ],
    sampleData: {
      recipientName: 'Meera',
      age: 27,
      message: 'Happy birthday! Tap around — there is more in here than you would think.',
      photos: [
        { full: '/samples/gift-1.webp', thumb: '/samples/gift-1-t.webp', width: 1080, height: 1350 },
        { full: '/samples/gift-2.webp', thumb: '/samples/gift-2-t.webp', width: 1080, height: 1350 },
      ],
      accent: 'blush',
    },
  },
  {
    id: 'wedding_invitation_classic',
    categoryId: 'wedding',
    name: 'The Invitation',
    tagline: 'An unfolding wedding invitation',
    description:
      'An envelope that opens into your ceremony details, a photo, a map and an RSVP the couple can read back.',
    thumbnailUrl: '/templates/wedding_invitation_classic/thumb.webp',
    previewImages: ['/templates/wedding_invitation_classic/p1.webp'],
    tierKey: 'C',
    live: true,
    displayOrder: 1,
    tags: ['wedding', 'invitation', 'rsvp', 'map'],
    supportsRsvp: true,
    og: {
      title: '{partnerOne} & {partnerTwo} are getting married',
      description: 'You are invited. Tap to see the details and RSVP.',
    },
    fields: [
      { key: 'partnerOne', type: 'text', label: 'First name', required: true, maxLength: 40 },
      { key: 'partnerTwo', type: 'text', label: 'Second name', required: true, maxLength: 40 },
      { key: 'ceremonyAt', type: 'dateTime', label: 'Ceremony date and time', required: true },
      { key: 'venue', type: 'location', label: 'Venue', required: true },
      {
        key: 'invitationNote',
        type: 'longText',
        label: 'Invitation note',
        required: true,
        maxLength: 600,
      },
      {
        key: 'photos',
        type: 'imageList',
        label: 'Photos',
        required: false,
        minItems: 0,
        maxItems: 8,
        aspectRatio: '3:4',
      },
      { key: 'dressCode', type: 'text', label: 'Dress code', required: false, maxLength: 80 },
      {
        key: 'rsvpEnabled',
        type: 'boolean',
        label: 'Collect RSVPs',
        required: false,
        defaultValue: true,
      },
    ],
    sampleData: {
      partnerOne: 'Sarah',
      partnerTwo: 'Raj',
      ceremonyAt: '2026-12-06T18:30:00+05:30',
      venue: {
        address: 'The Leela Palace, Old Airport Road, Bengaluru',
        latitude: 12.9606,
        longitude: 77.6486,
      },
      invitationNote:
        'Together with our families, we invite you to celebrate the beginning of our forever.',
      photos: [
        { full: '/samples/wed-1.webp', thumb: '/samples/wed-1-t.webp', width: 1200, height: 1600 },
      ],
      dressCode: 'Indian formal',
      rsvpEnabled: true,
    },
  },
  {
    id: 'proposal_memory_walk',
    categoryId: 'love',
    name: 'The Question',
    tagline: 'Memories, one by one, then the question',
    description:
      'Your story unfolds a memory at a time. At the end, the page asks the only question that matters.',
    thumbnailUrl: '/templates/proposal_memory_walk/thumb.webp',
    previewImages: ['/templates/proposal_memory_walk/p1.webp'],
    tierKey: 'C',
    live: true,
    displayOrder: 1,
    tags: ['proposal', 'romantic', 'timeline', 'cinematic'],
    supportsRsvp: false,
    og: {
      title: 'A message for {partnerName}',
      description: 'Someone has something to ask you.',
    },
    fields: [
      { key: 'partnerName', type: 'text', label: 'Their name', required: true, maxLength: 40 },
      {
        key: 'memories',
        type: 'groupList',
        label: 'Your moments',
        helpText: 'Three to seven moments, in the order they happened',
        required: true,
        minItems: 3,
        maxItems: 7,
        fields: memoryGroupFields,
      },
      {
        key: 'question',
        type: 'text',
        label: 'The question',
        required: true,
        maxLength: 80,
        defaultValue: 'Will you marry me?',
      },
      {
        key: 'closingNote',
        type: 'longText',
        label: 'After the question',
        required: false,
        maxLength: 400,
      },
    ],
    sampleData: {
      partnerName: 'Ananya',
      memories: [
        {
          title: 'The day we met',
          text: 'You laughed at something I said before I finished saying it.',
          image: {
            full: '/samples/mem-1.webp',
            thumb: '/samples/mem-1-t.webp',
            width: 1080,
            height: 1350,
          },
        },
        {
          title: 'Our first trip',
          text: 'We missed the train and it turned out to be the best day of the year.',
          image: {
            full: '/samples/mem-2.webp',
            thumb: '/samples/mem-2-t.webp',
            width: 1080,
            height: 1350,
          },
        },
        {
          title: 'Last winter',
          text: 'You fell asleep on my shoulder and I stayed still for an hour.',
          image: null,
        },
      ],
      question: 'Will you marry me?',
      closingNote: 'Whatever you say, thank you for all of it.',
    },
  },
  {
    id: 'anniversary_timeline',
    categoryId: 'anniversary',
    name: 'Our Years',
    tagline: 'A scrolling timeline of the two of you',
    description:
      'Year by year, the moments that made it. Works just as well for a first anniversary as a fortieth.',
    thumbnailUrl: '/templates/anniversary_timeline/thumb.webp',
    previewImages: ['/templates/anniversary_timeline/p1.webp'],
    tierKey: 'B',
    live: true,
    displayOrder: 1,
    tags: ['anniversary', 'timeline', 'photos'],
    supportsRsvp: false,
    og: {
      title: '{coupleNames}',
      description: 'Every year, one moment at a time.',
    },
    fields: [
      { key: 'coupleNames', type: 'text', label: 'Names', required: true, maxLength: 60 },
      { key: 'sinceDate', type: 'date', label: 'Together since', required: true },
      {
        key: 'moments',
        type: 'groupList',
        label: 'Moments',
        required: true,
        minItems: 2,
        maxItems: 12,
        fields: memoryGroupFields,
      },
      { key: 'message', type: 'longText', label: 'Message', required: true, maxLength: 500 },
    ],
    sampleData: {
      coupleNames: 'Priya and Karthik',
      sinceDate: '2018-02-11',
      moments: [
        {
          title: '2018',
          text: 'A coffee that ran four hours long.',
          image: {
            full: '/samples/ann-1.webp',
            thumb: '/samples/ann-1-t.webp',
            width: 1080,
            height: 1350,
          },
        },
        {
          title: '2021',
          text: 'The tiny apartment with the loud fridge.',
          image: null,
        },
      ],
      message: 'Every year has been my favourite year.',
    },
  },
  {
    id: 'greeting_open_letter',
    categoryId: 'greeting',
    name: 'The Letter',
    tagline: 'A letter that unseals itself',
    description:
      'A quiet, elegant envelope that opens to your words. Thank you, sorry, congratulations, or just because.',
    thumbnailUrl: '/templates/greeting_open_letter/thumb.webp',
    previewImages: ['/templates/greeting_open_letter/p1.webp'],
    tierKey: 'A',
    live: true,
    displayOrder: 1,
    tags: ['greeting', 'letter', 'thank you', 'simple'],
    supportsRsvp: false,
    og: {
      title: 'A letter for {recipientName}',
      description: 'From {senderName}, with something to say.',
    },
    fields: [
      { key: 'recipientName', type: 'text', label: 'To', required: true, maxLength: 40 },
      { key: 'senderName', type: 'text', label: 'From', required: true, maxLength: 40 },
      {
        key: 'occasion',
        type: 'choice',
        label: 'Occasion',
        required: true,
        options: [
          { value: 'thank_you', label: 'Thank you' },
          { value: 'sorry', label: 'Sorry' },
          { value: 'congratulations', label: 'Congratulations' },
          { value: 'good_luck', label: 'Good luck' },
          { value: 'thinking_of_you', label: 'Thinking of you' },
        ],
      },
      { key: 'letter', type: 'longText', label: 'Your letter', required: true, maxLength: 1200 },
      { key: 'photo', type: 'image', label: 'A photo', required: false, aspectRatio: '4:5' },
    ],
    sampleData: {
      recipientName: 'Divya',
      senderName: 'Nikhil',
      occasion: 'thank_you',
      letter:
        'I do not think I ever said it properly, so here it is written down where you can keep it.',
      photo: null,
    },
  },
];

const templatesById = new Map(TEMPLATES.map((t) => [t.id, t]));
const categoriesById = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getTemplate(id: string): TemplateDef | undefined {
  return templatesById.get(id);
}

/** Only live templates inside live categories are visible to the app. */
export function getLiveTemplate(id: string): TemplateDef | undefined {
  const template = templatesById.get(id);
  if (!template?.live) return undefined;
  return categoriesById.get(template.categoryId)?.live ? template : undefined;
}

export function getCategory(id: string): CategoryDef | undefined {
  return categoriesById.get(id);
}

export function listLiveCategories(): CategoryDef[] {
  return CATEGORIES.filter((c) => c.live).sort((a, b) => a.displayOrder - b.displayOrder);
}

export function listLiveTemplates(categoryId?: string): TemplateDef[] {
  return TEMPLATES.filter(
    (t) =>
      t.live &&
      categoriesById.get(t.categoryId)?.live &&
      (!categoryId || t.categoryId === categoryId),
  ).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
}
