import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../config.dart';
import 'auth_controller.dart';

/// The seeded Acme users (server/prisma/seed.ts), one per role.
const _demoPassword = 'Password123!';
const _demoAccounts = [
  (email: 'employee@acme.test', name: 'Sneha Nair', role: 'Employee', icon: Icons.person_outline),
  (email: 'manager@acme.test', name: 'Arjun Menon', role: 'Manager · 8 reports', icon: Icons.groups_outlined),
  (email: 'hr@acme.test', name: 'Fatima Al Mansoori', role: 'HR admin', icon: Icons.admin_panel_settings_outlined),
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
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.forum_outlined, size: 56, color: theme.colorScheme.primary),
                    const SizedBox(height: 16),
                    Text('Acme Assistant', textAlign: TextAlign.center, style: theme.textTheme.headlineMedium),
                    const SizedBox(height: 8),
                    Text(
                      'Ask about company policy, your leave, pay and benefits.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 32),
                    TextFormField(
                      controller: _email,
                      enabled: !_busy,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(labelText: 'Work email', prefixIcon: Icon(Icons.mail_outline)),
                      validator: (v) => (v == null || !v.contains('@')) ? 'Enter your work email' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _password,
                      enabled: !_busy,
                      obscureText: _hidePassword,
                      autofillHints: const [AutofillHints.password],
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _signIn(),
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          tooltip: _hidePassword ? 'Show password' : 'Hide password',
                          icon: Icon(_hidePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          onPressed: () => setState(() => _hidePassword = !_hidePassword),
                        ),
                      ),
                      validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Text(_error!, key: const Key('login-error'), style: TextStyle(color: theme.colorScheme.error)),
                    ],
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _busy ? null : _signIn,
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                      child: _busy
                          ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                          : const Text('Sign in'),
                    ),
                    if (showDemoAccounts) ...[
                      const SizedBox(height: 32),
                      Text('Demo accounts', style: theme.textTheme.titleSmall),
                      const SizedBox(height: 4),
                      Text(
                        'Same question, different answers: each role sees different HR data.',
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                      const SizedBox(height: 8),
                      Card(
                        margin: EdgeInsets.zero,
                        clipBehavior: Clip.antiAlias,
                        child: Column(
                          children: [
                            for (final a in _demoAccounts)
                              ListTile(
                                enabled: !_busy,
                                leading: Icon(a.icon),
                                title: Text(a.name),
                                subtitle: Text(a.role),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => _useDemo(a.email),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
