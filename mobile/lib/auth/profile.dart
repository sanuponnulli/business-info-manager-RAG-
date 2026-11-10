/// The signed-in employee, from `GET /api/v1/me`.
class Profile {
  const Profile({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.email,
    required this.jobTitle,
    required this.department,
    required this.role,
  });

  factory Profile.fromJson(Map<String, dynamic> json) => Profile(
        id: json['id'] as int,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        email: json['email'] as String,
        jobTitle: json['jobTitle'] as String,
        department: (json['department'] as Map<String, dynamic>)['name'] as String,
        role: Role.fromApi(json['role'] as String),
      );

  final int id;
  final String firstName;
  final String lastName;
  final String email;
  final String jobTitle;
  final String department;
  final Role role;

  String get fullName => '$firstName $lastName';
}

/// What the server lets this person see. The app only uses it for display;
/// the server enforces it on every request.
enum Role {
  employee('Employee'),
  manager('Manager'),
  hrAdmin('HR admin');

  const Role(this.label);
  final String label;

  static Role fromApi(String value) => switch (value) {
        'MANAGER' => Role.manager,
        'HR_ADMIN' => Role.hrAdmin,
        _ => Role.employee,
      };
}
