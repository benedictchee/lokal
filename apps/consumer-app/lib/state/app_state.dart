import 'package:flutter/foundation.dart';

import '../theme/colors.dart';

/// Global, lightweight app state (brand accent + cross-screen bits).
///
/// The mockups are largely static; this holds only the handful of values that
/// genuinely cross screens — the brand accent (the "Tweaks" panel in the shell)
/// and the set of saved/liked items.
class AppState extends ChangeNotifier {
  AccentSwatch _accent = BeegiiAccents.honey;
  AccentSwatch get accent => _accent;

  set accent(AccentSwatch value) {
    if (_accent == value) return;
    _accent = value;
    notifyListeners();
  }

  final Set<String> _saved = <String>{};
  bool isSaved(String id) => _saved.contains(id);
  void toggleSaved(String id) {
    if (!_saved.add(id)) _saved.remove(id);
    notifyListeners();
  }

  final Set<String> _liked = <String>{};
  bool isLiked(String id) => _liked.contains(id);
  void toggleLiked(String id) {
    if (!_liked.add(id)) _liked.remove(id);
    notifyListeners();
  }
}
