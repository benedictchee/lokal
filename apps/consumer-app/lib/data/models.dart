import 'package:flutter/widgets.dart';

/// A short media clip on a guide's profile / in the feed.
class MediaClip {
  const MediaClip({
    required this.grad,
    required this.scene,
    required this.dur,
    required this.hint,
  });
  final String grad; // gradient class g1..g6
  final String scene;
  final String dur;
  final String hint;
}

/// A bookable start-time option.
class TimeSlot {
  const TimeSlot(this.hour, this.ampm);
  final String hour;
  final String ampm;
}

/// A country a guide has visited (Profile → Countries tab).
class Visit {
  const Visit(this.name, this.iso2, this.flag, this.sublabel, this.grad);
  final String name;
  final String iso2;
  final String flag;
  final String sublabel;
  final String grad;
}

/// A product on a guide's profile Shop tab.
class ProfileShopItem {
  const ProfileShopItem(this.title, this.desc, this.price, this.grad);
  final String title;
  final String desc;
  final String price;
  final String grad;
}

/// A local guide / creator. Drives Explore, Profile, the book sheet and shop.
class Guide {
  const Guide({
    required this.id,
    required this.name,
    required this.handle,
    required this.init,
    required this.color,
    required this.badge,
    required this.role,
    required this.dist,
    required this.likes,
    required this.quote,
    required this.bio,
    required this.followers,
    required this.following,
    required this.tags,
    required this.price,
    required this.unit,
    required this.from,
    required this.times,
    required this.clips,
    required this.visits,
    required this.shop,
  });

  final String id;
  final String name;
  final String handle; // includes leading @
  final String init;
  final Color color;
  final String badge;
  final String role;
  final String dist;
  final String likes;
  final String quote;
  final String bio;
  final String followers;
  final String following;
  final List<String> tags;
  final String price; // e.g. "S$22"
  final String unit; // e.g. "/hr"
  final String from; // e.g. "half day from S$120"
  final List<TimeSlot> times;
  final List<MediaClip> clips;
  final List<Visit> visits;
  final List<ProfileShopItem> shop;

  String get displayHandle =>
      handle.startsWith('@') ? handle.substring(1) : handle;
  String get firstName => name.split(' ').first;
}

/// A reel card in the Search grid.
class SearchReel {
  const SearchReel({
    required this.gid,
    required this.who,
    required this.grad,
    required this.dur,
    required this.title,
    required this.sub,
    required this.hint,
    required this.kw,
  });
  final String gid;
  final String who;
  final String grad;
  final String dur;
  final String title;
  final String sub;
  final String hint;
  final String kw;
}

/// A trip on the Plan tab.
class Trip {
  const Trip({
    required this.id,
    required this.name,
    required this.city,
    required this.flag,
    required this.from,
    required this.month,
    required this.days,
    required this.pax,
    required this.dates,
    required this.gradKey,
    required this.state, // 'ongoing' | 'upcoming'
  });
  final String id;
  final String name;
  final String city;
  final String flag;
  final String from;
  final String month;
  final int days;
  final int pax;
  final String dates;
  final String gradKey; // BeegiiGradients.destination key
  final String state;
}

/// A destination on the Get Inspired screen.
class Destination {
  const Destination({
    required this.id,
    required this.name,
    required this.country,
    required this.flag,
    required this.tags,
    required this.vibe,
    required this.reels,
    required this.best,
    required this.budget,
    required this.flight,
    required this.flightHours,
    required this.months,
    required this.gradKey,
    required this.suffix,
  });
  final String id;
  final String name;
  final String country;
  final String flag;
  final List<String> tags;
  final String vibe;
  final int reels;
  final String best;
  final String budget;
  final String flight;
  final double flightHours;
  final List<String> months;
  final String gradKey;
  final String suffix;
}

class WhenPreset {
  const WhenPreset(
    this.id,
    this.title,
    this.subtitle,
    this.month,
    this.days,
    this.sparkle,
  );
  final String id;
  final String title;
  final String subtitle;
  final String month;
  final int days;
  final bool sparkle; // true = "I'm flexible" uses sparkle icon, else calendar
}

class FromOrigin {
  const FromOrigin(this.id, this.flag, this.city);
  final String id;
  final String flag;
  final String city;
}

// ---------- Planner ----------------------------------------------------

class ChecklistStep {
  ChecklistStep(this.label, {this.done = false});
  final String label;
  bool done;
}

class PlanInfo {
  const PlanInfo({
    required this.window,
    required this.price,
    required this.status,
    required this.refund,
    required this.cta,
    required this.note,
    required this.steps,
  });
  final String window;
  final String price;
  final String status;
  final String refund; // '—' means hide
  final String? cta;
  final String note;
  final List<String> steps;
}

class StoryReel {
  const StoryReel(this.cat, this.title, this.author, this.dur);
  final String cat;
  final String title;
  final String author;
  final String dur;
}

class StoriesInfo {
  const StoriesInfo({
    required this.title,
    required this.sub,
    required this.hero,
    required this.dur,
    required this.heroT,
    required this.heroBy,
    required this.reels,
  });
  final String title;
  final String sub;
  final String hero; // category gradient class
  final String dur;
  final String heroT;
  final String heroBy;
  final List<StoryReel> reels;
}

enum RailType { unbooked, booked, info }

enum StopIcon { plane, car, hotel, walk, ticket }

class PlannerStop {
  const PlannerStop({
    required this.id,
    required this.day,
    required this.icon,
    required this.tone,
    required this.rail,
    required this.time,
    required this.title,
    required this.summary,
    required this.plan,
    required this.stories,
  });
  final String id;
  final int day;
  final StopIcon icon;
  final Color tone;
  final RailType rail;
  final String time;
  final String title;
  final String summary;
  final PlanInfo plan;
  final StoriesInfo stories;
}

// ---------- Shop -------------------------------------------------------

class ShopProduct {
  const ShopProduct({
    required this.grad,
    required this.title,
    required this.price,
    required this.kind,
    required this.digital,
    required this.photo,
    required this.desc,
  });
  final String grad;
  final String title;
  final String price;
  final String kind;
  final bool digital;
  final String photo;
  final List<String> desc;
}

class ShopCatalog {
  const ShopCatalog({
    required this.id,
    required this.name,
    required this.init,
    required this.color,
    required this.products,
  });
  final String id;
  final String name;
  final String init;
  final Color color;
  final List<ShopProduct> products;
}

// ---------- Settings ---------------------------------------------------

class SettingsRow {
  const SettingsRow({
    required this.icon,
    required this.iconBg,
    required this.iconFg,
    required this.title,
    required this.subtitle,
    this.count,
  });
  final IconData icon;
  final Color iconBg;
  final Color iconFg;
  final String title;
  final String subtitle;
  final String? count;
}
