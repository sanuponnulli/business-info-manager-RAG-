import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../config.dart';
import '../ui/theme.dart';
import 'auth_controller.dart';

/// The seeded Acme users (server/prisma/seed.ts), one per role.
const _demoPassword = 'Password123!';
const _demoAccounts = [
  (email: 'employee@acme.test', name: 'Sneha Nair', role: 'Employee · own record only'),
  (email: 'manager@acme.test', name: 'Arjun Menon', role: 'Manager · plus 8 direct reports'),
  (email: 'hr@acme.test', name: 'Fatima Al Mansoori', role: 'HR admin · all employees'),
];

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _hidePassword = true;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    if (_busy || !_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).signIn(_email.text, _password.text);
      // Success: the app swaps this screen out (see app.dart).
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _useDemo(String email) {
    _email.text = email;
    _password.text = _demoPassword;
    _signIn();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: AutofillGroup(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Center(child: BrandMark(size: 64)),
                      const SizedBox(height: 20),
                      Text('Acme Assistant', textAlign: TextAlign.center, style: theme.textTheme.headlineMedium),
                      const SizedBox(height: 6),
                      Text(
                        'Answers from the employee handbook\nand your own HR record.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                      const SizedBox(height: 32),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(14),
                        child: ColoredBox(
                          color: scheme.surfaceContainer,
                          child: Column(
                            children: [
                              TextFormField(
                                controller: _email,
                                enabled: !_busy,
                                keyboardType: TextInputType.emailAddress,
                                autocorrect: false,
                                autofillHints: const [AutofillHints.email],
                                textInputAction: TextInputAction.next,
                                style: theme.textTheme.bodyLarge,
                                decoration: _fieldDecoration('Work email'),
                                validator: (v) => (v == null || !v.contains('@')) ? 'Enter your work email' : null,
                              ),
                              const Divider(indent: 16),
                              TextFormField(
                                controller: _password,
                                enabled: !_busy,
                                obscureText: _hidePassword,
                                autofillHints: const [AutofillHints.password],
                                textInputAction: TextInputAction.done,
                                onFieldSubmitted: (_) => _signIn(),
                                style: theme.textTheme.bodyLarge,
                                decoration: _fieldDecoration('Password').copyWith(
                                  suffixIcon: IconButton(
                                    tooltip: _hidePassword ? 'Show password' : 'Hide password',
                                    color: scheme.onSurfaceVariant,
                                    icon: Icon(_hidePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 20),
                                    onPressed: () => setState(() => _hidePassword = !_hidePassword),
                                  ),
                                ),
                                validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                          child: Row(
                            children: [
                              Icon(Icons.error_outline, size: 16, color: scheme.error),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  _error!,
                                  key: const Key('login-error'),
                                  style: theme.textTheme.bodySmall?.copyWith(color: scheme.error),
                                ),
                              ),
                            ],
                          ),
                        ),
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: _busy ? null : _signIn,
                        child: _busy
                            ? SizedBox.square(dimension: 20, child: CircularProgressIndicator.adaptive(strokeWidth: 2.5))
                            : const Text('Sign in'),
                      ),
                      if (showDemoAccounts) ...[
                        const SizedBox(height: 40),
                        GroupedSection(
                          header: 'Demo accounts',
                          footer: 'Ask the same question as each person: what the assistant can see depends on their role.',
                          children: [
                            for (final a in _demoAccounts)
                              GroupedRow(
                                leading: Monogram(name: a.name),
                                title: a.name,
                                subtitle: a.role,
                                chevron: true,
                                onTap: _busy ? null : () => _useDemo(a.email),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// A borderless field inside the grouped box (the box is the border).
  InputDecoration _fieldDecoration(String hint) => InputDecoration(
        hintText: hint,
        filled: false,
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        errorBorder: InputBorder.none,
        focusedErrorBorder: InputBorder.none,
        disabledBorder: InputBorder.none,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      );
}
