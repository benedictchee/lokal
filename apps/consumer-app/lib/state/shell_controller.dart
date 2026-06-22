import 'package:flutter/foundation.dart';

/// Ephemeral state for the app shell / bottom dock.
///
/// Replaces the `postMessage` protocol the HTML shell used to coordinate with
/// its iframes (sheet open/close, planner sub-screen, chat FAB badge/state).
class ShellController extends ChangeNotifier {
  bool _dockHidden = false;
  bool get dockHidden => _dockHidden;
  set dockHidden(bool v) {
    if (_dockHidden == v) return;
    _dockHidden = v;
    notifyListeners();
  }

  /// True while the Plan branch is showing the planner (not the trips list).
  /// Controls whether the Chat FAB appears.
  bool _plannerActive = false;
  bool get plannerActive => _plannerActive;
  set plannerActive(bool v) {
    if (_plannerActive == v) return;
    _plannerActive = v;
    notifyListeners();
  }

  bool _chatOpen = false;
  bool get chatOpen => _chatOpen;

  int _chatUnread = 2;
  int get chatUnread => _chatUnread;
  set chatUnread(int v) {
    if (_chatUnread == v) return;
    _chatUnread = v;
    notifyListeners();
  }

  void openChat() {
    _chatOpen = true;
    _chatUnread = 0;
    notifyListeners();
  }

  void closeChat() {
    if (!_chatOpen) return;
    _chatOpen = false;
    notifyListeners();
  }

  void toggleChat() => _chatOpen ? closeChat() : openChat();
}
