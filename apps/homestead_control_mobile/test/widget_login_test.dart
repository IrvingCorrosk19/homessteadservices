import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";
import "package:homestead_control_mobile/screens/login_screen.dart";
import "package:homestead_control_mobile/state/session_controller.dart";
import "package:homestead_control_mobile/theme/homestead_theme.dart";
import "package:provider/provider.dart";

void main() {
  testWidgets("login screen shows brand and password field", (tester) async {
    final session = SessionController(baseUrl: "https://example.test");
    session.booting = false;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: session,
        child: MaterialApp(
          theme: buildHomesteadTheme(),
          home: const LoginScreen(),
        ),
      ),
    );
    expect(find.text("HOMESTEAD"), findsOneWidget);
    expect(find.text("Control"), findsOneWidget);
    expect(find.text("Entrar"), findsOneWidget);
  });
}
