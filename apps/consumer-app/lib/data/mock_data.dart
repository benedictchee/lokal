import 'package:flutter/material.dart';

import 'models.dart';

/// All mock content, transcribed from the Beegii HTML mockups.
class MockData {
  MockData._();

  static const Color _amber = Color(0xFFB6730C);
  static const Color _green = Color(0xFF2E8F58);
  static const Color _violet = Color(0xFF7268B8);

  // ---- Guides ---------------------------------------------------------
  static const List<Guide> guides = [
    Guide(
      id: 'aisha',
      name: 'Aisha K.',
      handle: '@aisharoams',
      init: 'A',
      color: _amber,
      badge: 'Penang local',
      role: 'Heritage & street-art walks',
      dist: '0.4 km',
      likes: '3.1k',
      quote:
          'Come down the lane behind the lane — that’s where George Town actually lives.',
      bio:
          'Fifth-generation George Town local. I grew up between the clan jetties and the indigo shophouses, and I’ve spent ten years walking visitors through the lanes the tour buses miss — the working ones, not the postcard ones. Expect tea with an auntie, a mural with a story, and zero rushing.',
      followers: '18.2k',
      following: '312',
      tags: ['Heritage', 'Street art', 'Photo spots'],
      price: 'S\$22',
      unit: '/hr',
      from: 'half day from S\$120',
      times: [
        TimeSlot('12:00', 'PM'),
        TimeSlot('2:00', 'PM'),
        TimeSlot('4:00', 'PM'),
      ],
      clips: [
        MediaClip(
          grad: 'g1',
          scene: 'Armenian Street lanes',
          dur: '0:48',
          hint: 'walking a heritage shophouse lane',
        ),
        MediaClip(
          grad: 'g4',
          scene: 'The Blue Mansion at dusk',
          dur: '0:36',
          hint: 'the indigo Blue Mansion',
        ),
        MediaClip(
          grad: 'g2',
          scene: 'Kopi at Sin Hwa',
          dur: '0:22',
          hint: 'a kopitiam coffee close-up',
        ),
        MediaClip(
          grad: 'g3',
          scene: 'Mural lane, golden hour',
          dur: '0:41',
          hint: 'a George Town street mural',
        ),
      ],
      visits: [
        Visit(
          'Singapore',
          'SG',
          '\u{1F1F8}\u{1F1EC}',
          '12 reels · home base',
          'g1',
        ),
        Visit(
          'Malaysia',
          'MY',
          '\u{1F1F2}\u{1F1FE}',
          'Penang & KL · 6 reels',
          'g4',
        ),
        Visit(
          'Thailand',
          'TH',
          '\u{1F1F9}\u{1F1ED}',
          'Bangkok · 3 reels',
          'g3',
        ),
      ],
      shop: [
        ProfileShopItem(
          'Heritage walking tour',
          'Half-day Armenian St & clan jetties, small group',
          'S\$120',
          'g1',
        ),
        ProfileShopItem(
          'Street-art photo route',
          '2 hr guided photo spots + edits',
          'S\$66',
          'g4',
        ),
        ProfileShopItem(
          'Penang map zine',
          'Printed pocket guide, ships from SG',
          'S\$18',
          'g3',
        ),
      ],
    ),
    Guide(
      id: 'hafiz',
      name: 'Hafiz',
      handle: '@hafizpg',
      init: 'H',
      color: _green,
      badge: 'Penang local',
      role: 'Hawker food crawls',
      dist: '0.8 km',
      likes: '5.4k',
      quote:
          'Six stalls, one street, zero tourist traps. Bring an empty stomach.',
      bio:
          'I run a small food-tour outfit and I’ve been ranking char kway teow stalls since I could hold chopsticks. I take you to the stalls locals queue for, teach you how to order, and make sure you leave too full to walk straight.',
      followers: '24.6k',
      following: '198',
      tags: ['Hawker food', 'Markets', 'Coffee'],
      price: 'S\$18',
      unit: '/hr',
      from: 'crawl from S\$54pp',
      times: [
        TimeSlot('9:00', 'AM'),
        TimeSlot('6:00', 'PM'),
        TimeSlot('7:30', 'PM'),
      ],
      clips: [
        MediaClip(
          grad: 'g2',
          scene: 'Chulia St night market',
          dur: '0:32',
          hint: 'a sizzling hawker stall at night',
        ),
        MediaClip(
          grad: 'g3',
          scene: 'The cendol queue',
          dur: '0:19',
          hint: 'a bowl of cendol dessert',
        ),
        MediaClip(
          grad: 'g1',
          scene: 'Wan tan mee, slurp test',
          dur: '0:27',
          hint: 'a bowl of noodles close-up',
        ),
        MediaClip(
          grad: 'g6',
          scene: 'Supper under the lanterns',
          dur: '0:44',
          hint: 'a lantern-lit supper street',
        ),
      ],
      visits: [
        Visit(
          'Malaysia',
          'MY',
          '\u{1F1F2}\u{1F1FE}',
          'Penang · home base',
          'g2',
        ),
        Visit('Singapore', 'SG', '\u{1F1F8}\u{1F1EC}', '4 reels', 'g1'),
        Visit('Indonesia', 'ID', '\u{1F1EE}\u{1F1E9}', 'Medan · 2 reels', 'g5'),
      ],
      shop: [
        ProfileShopItem(
          'Hawker food crawl',
          'Evening 8-stop tasting, drinks included',
          'S\$54',
          'g2',
        ),
        ProfileShopItem(
          'Cooking class',
          'Make laksa & cendol with locals',
          'S\$80',
          'g3',
        ),
        ProfileShopItem(
          'Coffee bean pack',
          'House kopi-O blend, 250g',
          'S\$22',
          'g5',
        ),
      ],
    ),
    Guide(
      id: 'lina',
      name: 'Lina G.',
      handle: '@linaframes',
      init: 'L',
      color: _violet,
      badge: 'Penang local',
      role: 'Sunset photo walks',
      dist: '1.6 km',
      likes: '2.7k',
      quote:
          'I know exactly where the light lands at 6:40. Let’s get you a photo you’ll print.',
      bio:
          'Local photographer. I know exactly where the light falls at 6:40 PM and which rooftop the security guard will wave you up to. Part walk, part photo coaching — phone or camera, both welcome.',
      followers: '12.4k',
      following: '276',
      tags: ['Photo spots', 'Sunset', 'Rooftops'],
      price: 'S\$30',
      unit: '/hr',
      from: 'golden hour from S\$75pp',
      times: [
        TimeSlot('4:30', 'PM'),
        TimeSlot('5:30', 'PM'),
        TimeSlot('6:30', 'PM'),
      ],
      clips: [
        MediaClip(
          grad: 'g3',
          scene: 'Rooftop golden hour',
          dur: '1:04',
          hint: 'a rooftop at sunset',
        ),
        MediaClip(
          grad: 'g6',
          scene: 'Reflections, Chew Jetty',
          dur: '0:38',
          hint: 'the clan jetties at dusk',
        ),
        MediaClip(
          grad: 'g5',
          scene: 'Blue hour over the strait',
          dur: '0:29',
          hint: 'blue hour over the water',
        ),
      ],
      visits: [
        Visit(
          'Malaysia',
          'MY',
          '\u{1F1F2}\u{1F1FE}',
          'Penang · home base',
          'g3',
        ),
        Visit('Vietnam', 'VN', '\u{1F1FB}\u{1F1F3}', 'Hội An · 3 reels', 'g6'),
        Visit('Thailand', 'TH', '\u{1F1F9}\u{1F1ED}', 'Phuket · 2 reels', 'g4'),
      ],
      shop: [
        ProfileShopItem(
          'Golden-hour rooftop tour',
          'Sunset shoot at 3 vantage points',
          'S\$75',
          'g3',
        ),
        ProfileShopItem(
          'Print: Chew Jetty',
          'A3 archival photo print',
          'S\$45',
          'g6',
        ),
        ProfileShopItem(
          'Lightroom presets',
          'My Penang dusk pack, 8 presets',
          'S\$28',
          'g4',
        ),
      ],
    ),
    Guide(
      id: 'sora',
      name: 'Sora T.',
      handle: '@sorakyoto',
      init: 'S',
      color: _amber,
      badge: 'Kyoto guide',
      role: 'Temples & tea ceremony',
      dist: '—',
      likes: '6.8k',
      quote:
          'Quiet mornings, slow afternoons — Kyoto the way it’s meant to be.',
      bio:
          'Kyoto-born, tea-trained. I walk you through the temples before the crowds, the moss gardens the tour groups never reach, and a proper tea ceremony with my old teacher in Gion. Quiet mornings, slow afternoons.',
      followers: '41.3k',
      following: '164',
      tags: ['Temples', 'Tea', 'Gardens'],
      price: 'S\$40',
      unit: '/hr',
      from: 'temple half-day from S\$240',
      times: [
        TimeSlot('6:00', 'AM'),
        TimeSlot('9:00', 'AM'),
        TimeSlot('2:00', 'PM'),
      ],
      clips: [
        MediaClip(
          grad: 'g3',
          scene: 'Fushimi Inari at dawn',
          dur: '0:52',
          hint: 'vermilion torii gates at sunrise',
        ),
        MediaClip(
          grad: 'g1',
          scene: 'Arashiyama bamboo grove',
          dur: '0:38',
          hint: 'a tall bamboo forest path',
        ),
        MediaClip(
          grad: 'g4',
          scene: 'Tea ceremony in Gion',
          dur: '0:44',
          hint: 'a tea ceremony close-up',
        ),
        MediaClip(
          grad: 'g6',
          scene: 'Moss garden, Saiho-ji',
          dur: '0:31',
          hint: 'a green moss temple garden',
        ),
      ],
      visits: [
        Visit('Japan', 'JP', '\u{1F1EF}\u{1F1F5}', 'Kyoto · home base', 'g3'),
        Visit(
          'South Korea',
          'KR',
          '\u{1F1F0}\u{1F1F7}',
          'Seoul · 5 reels',
          'g1',
        ),
        Visit('Taiwan', 'TW', '\u{1F1F9}\u{1F1FC}', 'Taipei · 3 reels', 'g2'),
      ],
      shop: [
        ProfileShopItem(
          'Temple & tea half-day',
          'Fushimi Inari at dawn + tea ceremony',
          'S\$240',
          'g3',
        ),
        ProfileShopItem(
          'Bamboo grove shoot',
          'Private Arashiyama morning session',
          'S\$130',
          'g1',
        ),
        ProfileShopItem(
          'Kyoto preset pack',
          'Muted film tones, 10 presets',
          'S\$32',
          'g2',
        ),
      ],
    ),
    Guide(
      id: 'putu',
      name: 'Putu A.',
      handle: '@putuubud',
      init: 'P',
      color: _green,
      badge: 'Bali guide',
      role: 'Rice terraces & waterfalls',
      dist: '—',
      likes: '9.2k',
      quote: 'Bring shoes you can get muddy — the good stuff is off the road.',
      bio:
          'Ubud local, son of a rice farmer. I bring you to the terraces before the buses, the hidden waterfalls down jungle paths, and my aunt’s warung for the best babi guling you’ll ever eat. Bring shoes you can get muddy.',
      followers: '52.1k',
      following: '209',
      tags: ['Rice terraces', 'Waterfalls', 'Food'],
      price: 'S\$28',
      unit: '/hr',
      from: 'day tour from S\$95',
      times: [
        TimeSlot('7:00', 'AM'),
        TimeSlot('10:00', 'AM'),
        TimeSlot('3:00', 'PM'),
      ],
      clips: [
        MediaClip(
          grad: 'g1',
          scene: 'Tegallalang at sunrise',
          dur: '0:47',
          hint: 'green stepped rice terraces',
        ),
        MediaClip(
          grad: 'g5',
          scene: 'Hidden jungle waterfall',
          dur: '0:55',
          hint: 'a tall jungle waterfall',
        ),
        MediaClip(
          grad: 'g2',
          scene: 'Warung babi guling',
          dur: '0:29',
          hint: 'a local warung dish',
        ),
        MediaClip(
          grad: 'g3',
          scene: 'Rice fields, golden hour',
          dur: '0:41',
          hint: 'rice fields at golden hour',
        ),
      ],
      visits: [
        Visit(
          'Indonesia',
          'ID',
          '\u{1F1EE}\u{1F1E9}',
          'Bali · home base',
          'g1',
        ),
        Visit(
          'Australia',
          'AU',
          '\u{1F1E6}\u{1F1FA}',
          'Sydney · 4 reels',
          'g5',
        ),
        Visit('Singapore', 'SG', '\u{1F1F8}\u{1F1EC}', '2 reels', 'g4'),
      ],
      shop: [
        ProfileShopItem(
          'Rice terrace day tour',
          'Tegallalang sunrise + waterfall + warung',
          'S\$95',
          'g1',
        ),
        ProfileShopItem(
          'Waterfall photo trip',
          'Hidden jungle falls, gear provided',
          'S\$70',
          'g5',
        ),
        ProfileShopItem(
          'Bali travel ebook',
          '48-page local guide PDF',
          'S\$15',
          'g4',
        ),
      ],
    ),
    Guide(
      id: 'elif',
      name: 'Elif D.',
      handle: '@elifistanbul',
      init: 'E',
      color: _violet,
      badge: 'Istanbul guide',
      role: 'Bazaars & Bosphorus',
      dist: '—',
      likes: '7.4k',
      quote: 'Çay on a rooftop as the call to prayer rolls across the water.',
      bio:
          'Istanbul born and raised, on both sides of the strait. I navigate the bazaars like home, get you the real saffron, and end the day with çay on a Bosphorus rooftop as the call to prayer rolls across the water.',
      followers: '29.7k',
      following: '233',
      tags: ['Bazaars', 'Bosphorus', 'Food'],
      price: 'S\$35',
      unit: '/hr',
      from: 'half-day from S\$140',
      times: [
        TimeSlot('9:30', 'AM'),
        TimeSlot('1:00', 'PM'),
        TimeSlot('5:00', 'PM'),
      ],
      clips: [
        MediaClip(
          grad: 'g2',
          scene: 'Spice Bazaar colours',
          dur: '0:36',
          hint: 'mounds of colourful spices',
        ),
        MediaClip(
          grad: 'g4',
          scene: 'Bosphorus at blue hour',
          dur: '0:49',
          hint: 'the Bosphorus at dusk',
        ),
        MediaClip(
          grad: 'g3',
          scene: 'Simit & çay rooftop',
          dur: '0:24',
          hint: 'simit and tea on a rooftop',
        ),
        MediaClip(
          grad: 'g6',
          scene: 'Grand Bazaar lanterns',
          dur: '0:43',
          hint: 'lantern stalls in a bazaar',
        ),
      ],
      visits: [
        Visit(
          'Turkey',
          'TR',
          '\u{1F1F9}\u{1F1F7}',
          'İstanbul · home base',
          'g2',
        ),
        Visit('Greece', 'GR', '\u{1F1EC}\u{1F1F7}', 'Athens · 4 reels', 'g4'),
        Visit('Georgia', 'GE', '\u{1F1EC}\u{1F1EA}', 'Tbilisi · 2 reels', 'g3'),
      ],
      shop: [
        ProfileShopItem(
          'Bazaar & Bosphorus',
          'Half-day Spice Bazaar + ferry',
          'S\$140',
          'g2',
        ),
        ProfileShopItem(
          'Blue-hour boat shoot',
          'Private Bosphorus photo cruise',
          'S\$110',
          'g4',
        ),
        ProfileShopItem(
          'Spice gift box',
          'Curated Grand Bazaar selection',
          'S\$38',
          'g3',
        ),
      ],
    ),
  ];

  static Guide guideById(String id) =>
      guides.firstWhere((g) => g.id == id, orElse: () => guides.first);

  /// The Explore feed shows the three Penang locals.
  static List<Guide> get feedGuides =>
      ['aisha', 'hafiz', 'lina'].map(guideById).toList();

  // ---- Search reels (12) ---------------------------------------------
  static const List<SearchReel> searchReels = [
    SearchReel(
      gid: 'aisha',
      who: '@aisharoams',
      grad: 'g1',
      dur: '0:48',
      title: 'Armenian Street lanes',
      sub: '@aisharoams · Penang',
      hint: 'walking a heritage shophouse lane',
      kw: 'penang heritage george town walk lane shophouse',
    ),
    SearchReel(
      gid: 'sora',
      who: '@sorakyoto',
      grad: 'g3',
      dur: '0:52',
      title: 'Fushimi Inari at dawn',
      sub: '@sorakyoto · Kyoto',
      hint: 'empty vermilion torii gates at sunrise',
      kw: 'kyoto japan temple torii sunrise shrine',
    ),
    SearchReel(
      gid: 'putu',
      who: '@putuubud',
      grad: 'g1',
      dur: '0:47',
      title: 'Tegallalang at sunrise',
      sub: '@putuubud · Bali',
      hint: 'green stepped rice terraces in morning light',
      kw: 'bali ubud rice terrace sunrise nature',
    ),
    SearchReel(
      gid: 'hafiz',
      who: '@hafizpg',
      grad: 'g2',
      dur: '0:32',
      title: 'Chulia St night market',
      sub: '@hafizpg · Penang',
      hint: 'a sizzling hawker stall at night',
      kw: 'penang food hawker night market street',
    ),
    SearchReel(
      gid: 'elif',
      who: '@elifistanbul',
      grad: 'g2',
      dur: '0:36',
      title: 'Spice Bazaar colours',
      sub: '@elifistanbul · İstanbul',
      hint: 'mounds of colourful spices in a bazaar',
      kw: 'istanbul turkey bazaar spice market',
    ),
    SearchReel(
      gid: 'lina',
      who: '@linaframes',
      grad: 'g3',
      dur: '1:04',
      title: 'Rooftop golden hour',
      sub: '@linaframes · Penang',
      hint: 'a rooftop at sunset',
      kw: 'penang photo sunset rooftop golden hour',
    ),
    SearchReel(
      gid: 'putu',
      who: '@putuubud',
      grad: 'g5',
      dur: '0:55',
      title: 'Hidden jungle waterfall',
      sub: '@putuubud · Bali',
      hint: 'a tall jungle waterfall and pool',
      kw: 'bali waterfall jungle nature swim',
    ),
    SearchReel(
      gid: 'sora',
      who: '@sorakyoto',
      grad: 'g1',
      dur: '0:38',
      title: 'Arashiyama bamboo grove',
      sub: '@sorakyoto · Kyoto',
      hint: 'a tall green bamboo forest path',
      kw: 'kyoto japan bamboo forest nature walk',
    ),
    SearchReel(
      gid: 'aisha',
      who: '@aisharoams',
      grad: 'g4',
      dur: '0:36',
      title: 'The Blue Mansion at dusk',
      sub: '@aisharoams · Penang',
      hint: 'the indigo Blue Mansion',
      kw: 'penang heritage blue mansion dusk',
    ),
    SearchReel(
      gid: 'elif',
      who: '@elifistanbul',
      grad: 'g4',
      dur: '0:49',
      title: 'Bosphorus at blue hour',
      sub: '@elifistanbul · İstanbul',
      hint: 'the Bosphorus strait at dusk with mosques',
      kw: 'istanbul turkey bosphorus blue hour boat',
    ),
    SearchReel(
      gid: 'hafiz',
      who: '@hafizpg',
      grad: 'g6',
      dur: '0:44',
      title: 'Supper under the lanterns',
      sub: '@hafizpg · Penang',
      hint: 'a lantern-lit supper street',
      kw: 'penang food supper night lantern street',
    ),
    SearchReel(
      gid: 'lina',
      who: '@linaframes',
      grad: 'g5',
      dur: '0:29',
      title: 'Blue hour over the strait',
      sub: '@linaframes · Penang',
      hint: 'blue hour over the water',
      kw: 'penang photo blue hour water strait',
    ),
  ];

  // ---- Trips ----------------------------------------------------------
  static const List<Trip> trips = [
    Trip(
      id: 'penang',
      name: 'Penang heritage trip',
      city: 'Penang, Malaysia',
      flag: '\u{1F1F2}\u{1F1FE}',
      from: 'Singapore',
      month: 'Jun',
      days: 6,
      pax: 2,
      dates: '15–20 Jun',
      gradKey: 'penang',
      state: 'ongoing',
    ),
    Trip(
      id: 'bali',
      name: 'Bali escape',
      city: 'Bali, Indonesia',
      flag: '\u{1F1EE}\u{1F1E9}',
      from: 'Singapore',
      month: 'Aug',
      days: 7,
      pax: 2,
      dates: '9–15 Aug',
      gradKey: 'bali',
      state: 'upcoming',
    ),
    Trip(
      id: 'bangkok',
      name: 'Bangkok food run',
      city: 'Bangkok, Thailand',
      flag: '\u{1F1F9}\u{1F1ED}',
      from: 'Kuala Lumpur',
      month: 'Oct',
      days: 4,
      pax: 4,
      dates: '3–6 Oct',
      gradKey: 'bangkok',
      state: 'upcoming',
    ),
    Trip(
      id: 'tokyo',
      name: 'Tokyo adventure',
      city: 'Tokyo, Japan',
      flag: '\u{1F1EF}\u{1F1F5}',
      from: 'Singapore',
      month: 'Nov',
      days: 9,
      pax: 3,
      dates: '12–20 Nov',
      gradKey: 'tokyo',
      state: 'upcoming',
    ),
  ];

  // ---- Destinations (Get Inspired) -----------------------------------
  static const String thisMonth = 'Jun';
  static const List<Destination> destinations = [
    Destination(
      id: 'bali',
      name: 'Bali',
      country: 'Indonesia',
      flag: '\u{1F1EE}\u{1F1E9}',
      tags: ['beaches', 'nature'],
      vibe: 'Surf · rice terraces',
      reels: 48,
      best: 'Apr–Oct',
      budget: 'S\$1,200',
      flight: '2h 45m',
      flightHours: 2.75,
      months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
      gradKey: 'bali',
      suffix: 'escape',
    ),
    Destination(
      id: 'bangkok',
      name: 'Bangkok',
      country: 'Thailand',
      flag: '\u{1F1F9}\u{1F1ED}',
      tags: ['food', 'cities'],
      vibe: 'Street food capital',
      reels: 62,
      best: 'Nov–Feb',
      budget: 'S\$900',
      flight: '2h 20m',
      flightHours: 2.33,
      months: ['Nov', 'Dec', 'Jan', 'Feb'],
      gradKey: 'bangkok',
      suffix: 'food run',
    ),
    Destination(
      id: 'penang',
      name: 'Penang',
      country: 'Malaysia',
      flag: '\u{1F1F2}\u{1F1FE}',
      tags: ['food', 'culture'],
      vibe: 'Heritage & hawker',
      reels: 37,
      best: 'Dec–Apr',
      budget: 'S\$700',
      flight: '1h 25m',
      flightHours: 1.42,
      months: ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'Jun'],
      gradKey: 'penang',
      suffix: 'heritage trip',
    ),
    Destination(
      id: 'tokyo',
      name: 'Tokyo',
      country: 'Japan',
      flag: '\u{1F1EF}\u{1F1F5}',
      tags: ['cities', 'food'],
      vibe: 'Neon & nostalgia',
      reels: 91,
      best: 'Mar–May',
      budget: 'S\$2,400',
      flight: '7h 00m',
      flightHours: 7.0,
      months: ['Mar', 'Apr', 'May', 'Oct', 'Nov'],
      gradKey: 'tokyo',
      suffix: 'adventure',
    ),
    Destination(
      id: 'hcmc',
      name: 'Ho Chi Minh',
      country: 'Vietnam',
      flag: '\u{1F1FB}\u{1F1F3}',
      tags: ['food', 'cities'],
      vibe: 'Buzzing & cheap eats',
      reels: 44,
      best: 'Dec–Apr',
      budget: 'S\$850',
      flight: '2h 00m',
      flightHours: 2.0,
      months: ['Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
      gradKey: 'hcmc',
      suffix: 'food run',
    ),
    Destination(
      id: 'seoul',
      name: 'Seoul',
      country: 'South Korea',
      flag: '\u{1F1F0}\u{1F1F7}',
      tags: ['cities', 'food'],
      vibe: 'Cafés & palaces',
      reels: 73,
      best: 'Apr–Jun',
      budget: 'S\$2,200',
      flight: '6h 30m',
      flightHours: 6.5,
      months: ['Apr', 'May', 'Jun', 'Sep', 'Oct'],
      gradKey: 'seoul',
      suffix: 'city break',
    ),
    Destination(
      id: 'lombok',
      name: 'Lombok',
      country: 'Indonesia',
      flag: '\u{1F1EE}\u{1F1E9}',
      tags: ['beaches', 'nature'],
      vibe: 'Quiet white-sand bays',
      reels: 21,
      best: 'May–Sep',
      budget: 'S\$1,300',
      flight: '3h 05m',
      flightHours: 3.08,
      months: ['May', 'Jun', 'Jul', 'Aug', 'Sep'],
      gradKey: 'lombok',
      suffix: 'beach escape',
    ),
    Destination(
      id: 'chiangmai',
      name: 'Chiang Mai',
      country: 'Thailand',
      flag: '\u{1F1F9}\u{1F1ED}',
      tags: ['nature', 'culture'],
      vibe: 'Temples & mountains',
      reels: 33,
      best: 'Nov–Feb',
      budget: 'S\$950',
      flight: '3h 10m',
      flightHours: 3.17,
      months: ['Nov', 'Dec', 'Jan', 'Feb', 'Jun'],
      gradKey: 'chiangmai',
      suffix: 'getaway',
    ),
    Destination(
      id: 'danang',
      name: 'Da Nang',
      country: 'Vietnam',
      flag: '\u{1F1FB}\u{1F1F3}',
      tags: ['beaches', 'food'],
      vibe: 'Beach + old town',
      reels: 29,
      best: 'Feb–Aug',
      budget: 'S\$880',
      flight: '2h 50m',
      flightHours: 2.83,
      months: ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
      gradKey: 'danang',
      suffix: 'beach trip',
    ),
  ];

  static const List<(String, String, String)> filters = [
    ('all', 'All', ''),
    ('beaches', 'Beaches', '\u{1F3D6}'),
    ('food', 'Food', '\u{1F35C}'),
    ('cities', 'Cities', '\u{1F3D9}'),
    ('nature', 'Nature', '⛰'),
    ('culture', 'Culture', '\u{1F3DB}'),
  ];

  static const List<FromOrigin> origins = [
    FromOrigin('sin', '\u{1F1F8}\u{1F1EC}', 'Singapore'),
    FromOrigin('kul', '\u{1F1F2}\u{1F1FE}', 'Kuala Lumpur'),
    FromOrigin('cgk', '\u{1F1EE}\u{1F1E9}', 'Jakarta'),
    FromOrigin('hkg', '\u{1F1ED}\u{1F1F0}', 'Hong Kong'),
  ];

  static const List<WhenPreset> whenPresets = [
    WhenPreset('jun', 'June 2026', 'This month · warm & dry', 'Jun', 6, false),
    WhenPreset('jul', 'July 2026', 'Peak summer · book early', 'Jul', 7, false),
    WhenPreset(
      'wknd',
      'A long weekend',
      'Next available · 4 days',
      'Jun',
      4,
      false,
    ),
    WhenPreset(
      'flex',
      'I’m flexible',
      'Let Beegii suggest the best dates',
      'Jun',
      6,
      true,
    ),
  ];

  static const List<String> nameSuffixes = [
    'escape',
    'adventure',
    'getaway',
    'food run',
    'reset',
    'wander',
    'long weekend',
    'city break',
  ];

  static const List<String> buildSteps = [
    'Locking in your dates & route',
    'Beebok is scouting flights',
    'Beefun is gathering local picks',
    'Beemon is checking the budget',
  ];

  // ---- Planner --------------------------------------------------------
  static const Color _toneAir = Color(0xFF3D7DC4);
  static const Color _toneCar = Color(0xFF787E86);
  static const Color _toneHotel = Color(0xFFC77E16);
  static const Color _toneWalk = Color(0xFFBC8418);
  static const Color _toneTicket = Color(0xFF2E8F58);

  static const Map<int, String> dayDates = {1: 'Wed 15 Oct', 2: 'Thu 16 Oct'};

  static const List<PlannerStop> plannerStops = [
    PlannerStop(
      id: 'flight',
      day: 1,
      icon: StopIcon.plane,
      tone: _toneAir,
      rail: RailType.unbooked,
      time: '09:20 – 10:45',
      title: 'Flight to Penang · Scoot',
      summary:
          'Direct, 1h 25m on Scoot. S\$284 ×2 — not booked yet; fares have held steady this week.',
      plan: PlanInfo(
        window: 'Wed 15 Oct · 09:20–10:45',
        price: 'S\$284 ×2',
        status: 'Not booked',
        refund: 'Non-refundable',
        cta: 'Book on Scoot',
        note: 'Aisle + window on the right for the coastline view on descent.',
        steps: [
          'Web check-in (opens T-48h)',
          'Add 20kg checked bag each',
          'Screenshot boarding passes',
        ],
      ),
      stories: StoriesInfo(
        title: 'Landing in Penang',
        sub: '4 reels from recent travellers',
        hero: 'cat-adventure',
        dur: '1:24',
        heroT: 'Your first 24 hours in George Town',
        heroBy: '@penang.eats · 38k views',
        reels: [
          StoryReel(
            'cat-food',
            'Char kway teow 5 min from arrivals',
            '@penang.eats',
            '0:48',
          ),
          StoryReel(
            'cat-trail',
            'Airport → George Town by Grab',
            '@slowtravel.my',
            '1:12',
          ),
        ],
      ),
    ),
    PlannerStop(
      id: 'grab',
      day: 1,
      icon: StopIcon.car,
      tone: _toneCar,
      rail: RailType.info,
      time: 'Arrive 10:45',
      title: 'Airport to hotel · Grab',
      summary:
          '≈20 min to George Town with 2 bags. No need to pre-book — grab one at the arrivals rank.',
      plan: PlanInfo(
        window: 'Wed 15 Oct · from 10:45',
        price: '~S\$18',
        status: 'Book on arrival',
        refund: '—',
        cta: null,
        note:
            'GrabCar 4-seater fits 2 cases. Stand C at arrivals has the shortest queue.',
        steps: ['Buy a SIM / eSIM first', 'Confirm hotel pin in Grab'],
      ),
      stories: StoriesInfo(
        title: 'Getting into town',
        sub: '2 reels',
        hero: 'cat-trail',
        dur: '0:40',
        heroT: 'Arrivals → George Town, step by step',
        heroBy: '@slowtravel.my · 12k views',
        reels: [
          StoryReel(
            'cat-trail',
            'Where the Grab rank is',
            '@slowtravel.my',
            '0:40',
          ),
        ],
      ),
    ),
    PlannerStop(
      id: 'hotel',
      day: 1,
      icon: StopIcon.hotel,
      tone: _toneHotel,
      rail: RailType.unbooked,
      time: 'Check-in 15:00',
      title: 'The Blue Mansion',
      summary:
          'Heritage stay in the old town, 5 nights at S\$168/nt. Free cancellation up to 3 days before.',
      plan: PlanInfo(
        window: '15–20 Oct · 5 nights',
        price: 'S\$168/nt',
        status: 'Not booked',
        refund: 'Free cancel (T-3d)',
        cta: 'Reserve room',
        note:
            'Request a courtyard-facing room — quieter and gets the morning light.',
        steps: [
          'Pick room type',
          'Note 3pm check-in / 12pm out',
          'Ask about heritage tour times',
        ],
      ),
      stories: StoriesInfo(
        title: 'Around the Blue Mansion',
        sub: '6 reels & guides',
        hero: 'cat-luxury',
        dur: '2:05',
        heroT: 'Staying in a Cheong Fatt Tze courtyard',
        heroBy: '@heritage.stays · 54k views',
        reels: [
          StoryReel(
            'cat-food',
            'Breakfast spots on the same street',
            '@penang.eats',
            '1:02',
          ),
          StoryReel(
            'cat-trail',
            'Best mural wall, 2 min walk',
            '@artwalk.pg',
            '0:55',
          ),
        ],
      ),
    ),
    PlannerStop(
      id: 'walk',
      day: 2,
      icon: StopIcon.walk,
      tone: _toneWalk,
      rail: RailType.info,
      time: 'From 08:30',
      title: 'Street-art walk + Khoo Kongsi',
      summary:
          'Self-guided mural trail ending at the Khoo Kongsi clan house. No booking — go early to beat the heat.',
      plan: PlanInfo(
        window: 'Thu 16 Oct · 08:30–11:30',
        price: 'Khoo Kongsi S\$10 ×2',
        status: 'No booking',
        refund: '—',
        cta: null,
        note:
            'Start at Armenian St while it’s cool. Cash for the clan house entry.',
        steps: ['Save the mural map offline', 'Bring water + cash'],
      ),
      stories: StoriesInfo(
        title: 'The mural trail, on film',
        sub: '4 reels',
        hero: 'cat-trail',
        dur: '1:38',
        heroT: 'Every mural in walking order',
        heroBy: '@artwalk.pg · 27k views',
        reels: [
          StoryReel(
            'cat-trail',
            'Khoo Kongsi at opening time',
            '@slowtravel.my',
            '0:51',
          ),
          StoryReel(
            'cat-food',
            'Coffee stop mid-trail',
            '@penang.eats',
            '0:44',
          ),
        ],
      ),
    ),
    PlannerStop(
      id: 'entopia',
      day: 2,
      icon: StopIcon.ticket,
      tone: _toneTicket,
      rail: RailType.unbooked,
      time: '14:00',
      title: 'Entopia Butterfly Farm',
      summary:
          '15,000 butterflies in a covered garden — good for the afternoon heat. 2 tickets at S\$22 each.',
      plan: PlanInfo(
        window: 'Thu 16 Oct · afternoon',
        price: 'S\$22 ×2',
        status: 'Not booked',
        refund: 'Free reschedule',
        cta: 'Buy tickets',
        note:
            'Allow ~2 hours. The indoor section is air-conditioned if it’s hot.',
        steps: ['Pick a time slot', 'Save mobile tickets'],
      ),
      stories: StoriesInfo(
        title: 'Inside Entopia',
        sub: '3 reels',
        hero: 'cat-adventure',
        dur: '1:10',
        heroT: '15,000 butterflies — see it first',
        heroBy: '@kids.kl · 19k views',
        reels: [
          StoryReel(
            'cat-adventure',
            'The release garden at 2pm',
            '@kids.kl',
            '0:58',
          ),
        ],
      ),
    ),
  ];

  static const String plannerTitle = 'Penang & Langkawi';

  // ---- Shop catalogs --------------------------------------------------
  static const List<ShopCatalog> shops = [
    ShopCatalog(
      id: 'aisha',
      name: 'Aisha K.',
      init: 'A',
      color: _amber,
      products: [
        ShopProduct(
          grad: 'g2',
          title: 'George Town Lanes Zine',
          price: 'S\$14',
          kind: 'Printed zine',
          digital: false,
          photo: 'a printed travel zine cover',
          desc: [
            'A 32-page risograph zine mapping my favourite back lanes — the working ones, not the postcard ones. Hand-bound in small batches.',
            'Ships from Penang in a stiff mailer. Allow 5–9 days within SEA.',
          ],
        ),
        ShopProduct(
          grad: 'g4',
          title: 'Blue Mansion Print · A4',
          price: 'S\$28',
          kind: 'Art print',
          digital: false,
          photo: 'an indigo art print',
          desc: [
            'Giclée print of the Cheong Fatt Tze mansion at dusk, on 240gsm matte stock. Unframed.',
            'Rolled and shipped in a tube.',
          ],
        ),
        ShopProduct(
          grad: 'g1',
          title: 'Hand-drawn Heritage Map',
          price: 'S\$9',
          kind: 'Printed map',
          digital: false,
          photo: 'a hand-drawn city map',
          desc: [
            'Folded A2 map of old George Town, drawn by hand and marked with the stops I actually send people to.',
          ],
        ),
        ShopProduct(
          grad: 'g3',
          title: 'Mural Lane Postcard Set',
          price: 'S\$12',
          kind: 'Postcard set',
          digital: false,
          photo: 'a set of postcards',
          desc: [
            'Set of six postcards from the mural lanes. Blank backs, printed locally.',
          ],
        ),
      ],
    ),
    ShopCatalog(
      id: 'hafiz',
      name: 'Hafiz',
      init: 'H',
      color: _green,
      products: [
        ShopProduct(
          grad: 'g3',
          title: 'Stall Map · 30 Best Bites',
          price: 'S\$12',
          kind: 'Digital · PDF',
          digital: true,
          photo: 'a food map illustration',
          desc: [
            'A downloadable map pinning the 30 stalls I send everyone to, with what to order at each and the best hours to go.',
            'Instant PDF download after checkout — print it or keep it on your phone.',
          ],
        ),
        ShopProduct(
          grad: 'g1',
          title: 'Char Kway Teow Spice Kit',
          price: 'S\$24',
          kind: 'Spice kit',
          digital: false,
          photo: 'a packaged spice kit',
          desc: [
            'Everything for the smoky wok-fried classic except the wok — chilli paste, dried shrimp, and the recipe card I use.',
            'Ships from Penang, shelf-stable.',
          ],
        ),
        ShopProduct(
          grad: 'g6',
          title: 'Late-Night Eats Guide',
          price: 'S\$8',
          kind: 'Digital · PDF',
          digital: true,
          photo: 'a small food guidebook',
          desc: ['The after-10pm stalls, mapped. Instant download.'],
        ),
      ],
    ),
    ShopCatalog(
      id: 'lina',
      name: 'Lina G.',
      init: 'L',
      color: _violet,
      products: [
        ShopProduct(
          grad: 'g6',
          title: 'Penang Lightroom Presets',
          price: 'S\$19',
          kind: 'Digital · presets',
          digital: true,
          photo: 'a photo preset preview',
          desc: [
            'Ten presets I use for George Town light — warm golden hour and moody blue hour, tuned for phone and camera RAW.',
            'Instant download with an install guide.',
          ],
        ),
        ShopProduct(
          grad: 'g3',
          title: 'Print Set · George Town (3)',
          price: 'S\$45',
          kind: 'Photo prints',
          digital: false,
          photo: 'a set of photo prints',
          desc: [
            'Three signed A4 prints from my George Town series, on matte fine-art stock.',
            'Shipped flat with backing board.',
          ],
        ),
        ShopProduct(
          grad: 'g5',
          title: 'Rooftop Spots PDF Guide',
          price: 'S\$11',
          kind: 'Digital · PDF',
          digital: true,
          photo: 'a photo location guide',
          desc: [
            'Every rooftop and the exact time the light lands. Instant download.',
          ],
        ),
      ],
    ),
  ];

  static ShopCatalog shopById(String id) =>
      shops.firstWhere((s) => s.id == id, orElse: () => shops.first);

  // ---- Settings -------------------------------------------------------
  static const List<SettingsRow> settingsAccount = [
    SettingsRow(
      icon: Icons.bookmark_border_rounded,
      iconBg: Color(0xFFFBE7BE),
      iconFg: Color(0xFFB6730C),
      title: 'Saved & liked',
      subtitle: 'Reels, guides & experiences',
      count: '24',
    ),
    SettingsRow(
      icon: Icons.account_balance_wallet_outlined,
      iconBg: Color(0xFFE5F4EB),
      iconFg: Color(0xFF1F9D57),
      title: 'Bookings & payments',
      subtitle: '3 confirmed · 1 pending',
    ),
    SettingsRow(
      icon: Icons.credit_card_rounded,
      iconBg: Color(0xFFE7E4F2),
      iconFg: Color(0xFF6C5CC4),
      title: 'Payment methods',
      subtitle: 'Visa · 4291',
    ),
  ];

  static const List<SettingsRow> settingsPrefs = [
    SettingsRow(
      icon: Icons.tune_rounded,
      iconBg: Color(0xFFE2EAF4),
      iconFg: Color(0xFF3667B0),
      title: 'Travel preferences',
      subtitle: 'Pace, budget, dietary',
    ),
    SettingsRow(
      icon: Icons.notifications_none_rounded,
      iconBg: Color(0xFFF6E0D5),
      iconFg: Color(0xFFD2622F),
      title: 'Notifications',
      subtitle: 'Price drops, conditions, replies',
    ),
    SettingsRow(
      icon: Icons.help_outline_rounded,
      iconBg: Color(0xFFECECEB),
      iconFg: Color(0xFF5A6068),
      title: 'Help & support',
      subtitle: 'FAQ, contact the team',
    ),
  ];

  static const String version = 'Beegii · v8.0 · made with the bees';
}
