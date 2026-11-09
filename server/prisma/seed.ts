/**
 * Fills the HR database with a fictional company, "Acme", big enough to be
 * realistic: ~130 people in 8 departments across 4 offices, two years of
 * leave history, monthly payslips and benefit enrollments.
 *
 *   npm run db:seed        (wipes the tables first, so it can be re-run)
 *
 * Everything random comes from a fixed faker seed, so the same people and
 * numbers come out every time. Dates that depend on "today" (is a leave
 * request in the past or the future? has this month's payslip been paid?)
 * use the real date at seeding time.
 *
 * Demo logins (all share the password "Password123!"):
 *   employee@acme.test  an engineer in Kochi, reports to manager@acme.test
 *   manager@acme.test   an engineering manager with a team of direct reports
 *   hr@acme.test        HR admin
 */
import { faker, fakerEN_GB, fakerEN_IN, fakerEN_US, type Faker } from "@faker-js/faker";
import { createPrisma } from "../src/clients/db.js";
import { hashPassword } from "../src/lib/password.js";
import type {
  BenefitCategory,
  CoverageLevel,
  EmployeeStatus,
  EmploymentType,
  LeaveStatus,
  LeaveType,
  Role,
} from "../src/generated/prisma/client.js";

const SEED = 42;
const YEARS = [2025, 2026] as const;
const DEMO_PASSWORD = "Password123!";
const DOMAIN = "acme.test"; // .test is reserved: these addresses can never be real

for (const f of [faker, fakerEN_GB, fakerEN_IN, fakerEN_US]) f.seed(SEED);

// --- Dates (all at UTC midnight, matching Postgres DATE columns) ------------

const DAY_MS = 86_400_000;
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6; // all offices: Sat–Sun
const now = new Date();
const TODAY = day(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
const minDate = (a: Date, b: Date) => (a < b ? a : b);
const maxDate = (a: Date, b: Date) => (a > b ? a : b);
const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Reference data -------------------------------------------------------

const LOCATIONS = [
  { code: "DXB", name: "Dubai HQ", city: "Dubai", country: "AE", timezone: "Asia/Dubai", currency: "AED" },
  { code: "COK", name: "Kochi Office", city: "Kochi", country: "IN", timezone: "Asia/Kolkata", currency: "INR" },
  { code: "BLR", name: "Bengaluru Office", city: "Bengaluru", country: "IN", timezone: "Asia/Kolkata", currency: "INR" },
  { code: "LON", name: "London Office", city: "London", country: "GB", timezone: "Europe/London", currency: "GBP" },
] as const;
type LocationCode = (typeof LOCATIONS)[number]["code"];
type Country = (typeof LOCATIONS)[number]["country"];
const countryOf = (code: LocationCode): Country => LOCATIONS.find((l) => l.code === code)!.country;

/** [month, day, name]. Movable feasts are listed per year (demo approximations). */
const HOLIDAYS: Record<LocationCode, Record<number, [number, number, string][]>> = {
  DXB: {
    2025: [[1, 1, "New Year's Day"], [3, 30, "Eid al-Fitr"], [3, 31, "Eid al-Fitr holiday"], [4, 1, "Eid al-Fitr holiday"], [6, 5, "Arafat Day"], [6, 6, "Eid al-Adha"], [6, 7, "Eid al-Adha holiday"], [6, 26, "Islamic New Year"], [9, 4, "Prophet's Birthday"], [12, 1, "Commemoration Day"], [12, 2, "National Day"], [12, 3, "National Day holiday"]],
    2026: [[1, 1, "New Year's Day"], [3, 20, "Eid al-Fitr"], [3, 21, "Eid al-Fitr holiday"], [3, 22, "Eid al-Fitr holiday"], [5, 26, "Arafat Day"], [5, 27, "Eid al-Adha"], [5, 28, "Eid al-Adha holiday"], [6, 16, "Islamic New Year"], [8, 25, "Prophet's Birthday"], [12, 1, "Commemoration Day"], [12, 2, "National Day"], [12, 3, "National Day holiday"]],
  },
  COK: {
    2025: [[1, 26, "Republic Day"], [4, 14, "Vishu"], [4, 18, "Good Friday"], [5, 1, "May Day"], [8, 15, "Independence Day"], [9, 5, "Thiruvonam"], [10, 2, "Gandhi Jayanti"], [10, 20, "Deepavali"], [12, 25, "Christmas"]],
    2026: [[1, 26, "Republic Day"], [4, 3, "Good Friday"], [4, 15, "Vishu"], [5, 1, "May Day"], [8, 15, "Independence Day"], [8, 26, "Thiruvonam"], [10, 2, "Gandhi Jayanti"], [11, 8, "Deepavali"], [12, 25, "Christmas"]],
  },
  BLR: {
    2025: [[1, 14, "Makara Sankranti"], [1, 26, "Republic Day"], [3, 30, "Ugadi"], [5, 1, "May Day"], [8, 15, "Independence Day"], [10, 2, "Gandhi Jayanti"], [10, 20, "Deepavali"], [11, 1, "Karnataka Rajyotsava"], [12, 25, "Christmas"]],
    2026: [[1, 14, "Makara Sankranti"], [1, 26, "Republic Day"], [3, 19, "Ugadi"], [5, 1, "May Day"], [8, 15, "Independence Day"], [10, 2, "Gandhi Jayanti"], [11, 1, "Karnataka Rajyotsava"], [11, 8, "Deepavali"], [12, 25, "Christmas"]],
  },
  LON: {
    2025: [[1, 1, "New Year's Day"], [4, 18, "Good Friday"], [4, 21, "Easter Monday"], [5, 5, "Early May bank holiday"], [5, 26, "Spring bank holiday"], [8, 25, "Summer bank holiday"], [12, 25, "Christmas Day"], [12, 26, "Boxing Day"]],
    2026: [[1, 1, "New Year's Day"], [4, 3, "Good Friday"], [4, 6, "Easter Monday"], [5, 4, "Early May bank holiday"], [5, 25, "Spring bank holiday"], [8, 31, "Summer bank holiday"], [12, 25, "Christmas Day"], [12, 28, "Boxing Day (substitute day)"]],
  },
};

/** Department, its size, where its people sit (weighted), and job titles by level. */
const DEPARTMENTS = [
  { code: "EXE", name: "Executive", size: 4, offices: { DXB: 1 }, titles: { ic: ["Executive Assistant", "Chief of Staff"], manager: "Chief Operating Officer", head: "Chief Executive Officer" } },
  { code: "ENG", name: "Engineering", size: 44, offices: { COK: 5, BLR: 4, LON: 1 }, titles: { ic: ["Software Engineer", "Senior Software Engineer", "Flutter Developer", "Backend Engineer", "QA Engineer", "DevOps Engineer", "Staff Engineer"], manager: "Engineering Manager", head: "VP of Engineering" } },
  { code: "PRD", name: "Product", size: 12, offices: { BLR: 2, LON: 2, DXB: 1 }, titles: { ic: ["Product Manager", "Senior Product Manager", "Product Analyst"], manager: "Group Product Manager", head: "Head of Product" } },
  { code: "DES", name: "Design", size: 10, offices: { BLR: 2, COK: 1, LON: 1 }, titles: { ic: ["Product Designer", "Senior Product Designer", "UX Researcher"], manager: "Design Manager", head: "Head of Design" } },
  { code: "SAL", name: "Sales", size: 24, offices: { DXB: 3, LON: 2 }, titles: { ic: ["Account Executive", "Senior Account Executive", "Sales Development Representative", "Solutions Consultant"], manager: "Sales Manager", head: "VP of Sales" } },
  { code: "MKT", name: "Marketing", size: 14, offices: { DXB: 2, LON: 1, BLR: 1 }, titles: { ic: ["Marketing Specialist", "Content Writer", "Growth Marketer", "Brand Designer"], manager: "Marketing Manager", head: "Head of Marketing" } },
  { code: "FIN", name: "Finance", size: 11, offices: { DXB: 2, COK: 1 }, titles: { ic: ["Accountant", "Financial Analyst", "Payroll Specialist"], manager: "Finance Manager", head: "Chief Financial Officer" } },
  { code: "HR", name: "People & HR", size: 10, offices: { DXB: 1, COK: 1, LON: 1 }, titles: { ic: ["HR Generalist", "Talent Acquisition Partner", "HR Business Partner"], manager: "HR Manager", head: "Head of People" } },
] as const;

type Level = "exec" | "head" | "manager" | "ic";

/** Annual base salary ranges by country and level, in local currency. */
const SALARY: Record<Country, Record<Level, [number, number]>> = {
  AE: { exec: [1_000_000, 1_300_000], head: [540_000, 720_000], manager: [360_000, 480_000], ic: [120_000, 300_000] },
  IN: { exec: [12_000_000, 15_000_000], head: [6_500_000, 9_000_000], manager: [4_000_000, 6_000_000], ic: [700_000, 3_500_000] },
  GB: { exec: [220_000, 260_000], head: [140_000, 180_000], manager: [100_000, 130_000], ic: [42_000, 95_000] },
};

/** Days per year by country. PARENTAL and UNPAID have no running balance. */
const ENTITLEMENT: Record<Country, Partial<Record<LeaveType, number>>> = {
  AE: { ANNUAL: 30, SICK: 15, PERSONAL: 3 },
  IN: { ANNUAL: 24, SICK: 12, PERSONAL: 3 },
  GB: { ANNUAL: 25, SICK: 10, PERSONAL: 3 },
};
const BALANCE_TYPES = ["ANNUAL", "SICK", "PERSONAL"] as const satisfies LeaveType[];
const MAX_CARRY_OVER = 5;

const REASONS: Partial<Record<LeaveType, string[]>> = {
  ANNUAL: ["Family vacation", "Visiting family back home", "Wedding in the family", "Travel", "Rest and recharge", "Long weekend trip"],
  SICK: ["Fever", "Flu", "Medical appointment", "Migraine", "Food poisoning", "Back pain"],
  PERSONAL: ["Moving house", "Visa appointment", "Child's school event", "Bank and paperwork", "Family emergency"],
  PARENTAL: ["Birth of a child"],
};
const REJECTION_NOTES = ["Release week, please pick other dates", "Team coverage too low that week", "Overlaps with the quarterly planning offsite"];

// --- Small random helpers (all from the seeded faker) ---------------------

const int = (min: number, max: number) => faker.number.int({ min, max });
const chance = (p: number) => faker.number.float({ min: 0, max: 1 }) < p;
const pick = <T>(items: readonly T[]) => faker.helpers.arrayElement(items);
function weighted<T extends string>(weights: Partial<Record<T, number>>): T {
  return faker.helpers.weightedArrayElement(Object.entries(weights).map(([value, weight]) => ({ value: value as T, weight: weight as number })));
}

function nameFaker(location: LocationCode): Faker {
  if (location === "COK" || location === "BLR") return fakerEN_IN;
  if (location === "LON") return chance(0.7) ? fakerEN_GB : fakerEN_IN;
  return pick([fakerEN_IN, fakerEN_IN, fakerEN_GB, fakerEN_US]); // Dubai: an international mix
}

function phoneFor(country: Country): string {
  const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join("");
  if (country === "AE") return `+971 5${int(0, 8)} ${digits(3)} ${digits(4)}`;
  if (country === "IN") return `+91 ${int(7, 9)}${digits(4)} ${digits(5)}`;
  return `+44 7${digits(3)} ${digits(6)}`;
}

// --- People ---------------------------------------------------------------

interface Person {
  id: number;
  employeeCode: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  phone: string;
  role: Role;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  hireDate: Date;
  terminationDate: Date | null;
  departmentCode: string;
  location: LocationCode;
  managerId: number | null;
  level: Level;
  annualSalary: number;
}

const people: Person[] = [];
const usedEmails = new Set<string>();

function emailFor(first: string, last: string): string {
  const base = `${first}.${last}`.toLowerCase().normalize("NFKD").replace(/[^a-z.]/g, "");
  let email = `${base}@${DOMAIN}`;
  for (let n = 2; usedEmails.has(email); n++) email = `${base}${n}@${DOMAIN}`;
  usedEmails.add(email);
  return email;
}

function addPerson(p: {
  departmentCode: string;
  location: LocationCode;
  level: Level;
  jobTitle: string;
  managerId: number | null;
  role?: Role;
  email?: string;
  firstName?: string;
  lastName?: string;
  employmentType?: EmploymentType;
  hireDate?: Date;
}): Person {
  const f = nameFaker(p.location);
  const firstName = p.firstName ?? f.person.firstName();
  const lastName = p.lastName ?? f.person.lastName();
  const email = p.email ?? emailFor(firstName, lastName);
  usedEmails.add(email);
  const country = countryOf(p.location);
  // Leaders joined earlier on average; ICs any time up to a few weeks ago.
  const earliest = p.level === "ic" ? day(2017, 1, 1) : day(2014, 1, 1);
  const latest = p.level === "ic" ? addDays(TODAY, -21) : day(2022, 12, 31);
  const [lo, hi] = SALARY[country][p.level];
  const id = people.length + 1;
  const person: Person = {
    id,
    employeeCode: `E${String(id).padStart(4, "0")}`,
    email,
    firstName,
    lastName,
    jobTitle: p.jobTitle,
    phone: phoneFor(country),
    role: p.role ?? (p.level === "ic" ? "EMPLOYEE" : "MANAGER"),
    employmentType: p.employmentType ?? (p.level === "ic" ? weighted<EmploymentType>({ FULL_TIME: 85, PART_TIME: 8, CONTRACT: 7 }) : "FULL_TIME"),
    status: "ACTIVE",
    hireDate: p.hireDate ?? faker.date.between({ from: earliest, to: latest }),
    terminationDate: null,
    departmentCode: p.departmentCode,
    location: p.location,
    managerId: p.managerId,
    level: p.level,
    annualSalary: Math.round(int(lo, hi) / 1000) * 1000,
  };
  person.hireDate = day(person.hireDate.getUTCFullYear(), person.hireDate.getUTCMonth() + 1, person.hireDate.getUTCDate());
  people.push(person);
  return person;
}

function buildOrg(): { heads: Map<string, number> } {
  const exe = DEPARTMENTS[0];
  const ceo = addPerson({ departmentCode: "EXE", location: "DXB", level: "exec", jobTitle: exe.titles.head, managerId: null });
  const heads = new Map<string, number>([["EXE", ceo.id]]);

  for (const dept of DEPARTMENTS) {
    const isExec = dept.code === "EXE";
    const hrRole = (level: Level): Role | undefined => (dept.code === "HR" ? "HR_ADMIN" : level === "ic" ? "EMPLOYEE" : undefined);

    const head = isExec
      ? ceo
      : addPerson({
          departmentCode: dept.code,
          location: weighted<LocationCode>(dept.offices),
          level: "head",
          jobTitle: dept.titles.head,
          managerId: ceo.id,
          role: hrRole("head"),
          ...(dept.code === "HR" ? { email: `hr@${DOMAIN}`, firstName: "Fatima", lastName: "Al Mansoori" } : {}),
        });
    heads.set(dept.code, head.id);

    // One manager per ~8 people, each with their own team.
    const remaining = dept.size - 1;
    const managerCount = isExec ? 1 : Math.max(1, Math.round(remaining / 9));
    const managers: Person[] = [];
    for (let m = 0; m < managerCount; m++) {
      const isDemoManager = dept.code === "ENG" && m === 0;
      managers.push(
        addPerson({
          departmentCode: dept.code,
          location: isDemoManager ? "COK" : weighted<LocationCode>(dept.offices),
          level: isExec ? "exec" : "manager",
          jobTitle: dept.titles.manager,
          managerId: head.id,
          role: hrRole("manager"),
          ...(isDemoManager ? { email: `manager@${DOMAIN}`, firstName: "Arjun", lastName: "Menon" } : {}),
        }),
      );
    }

    const icCount = remaining - managerCount;
    for (let i = 0; i < icCount; i++) {
      const manager = managers[i % managers.length];
      const isDemoEmployee = dept.code === "ENG" && i === 0;
      addPerson({
        departmentCode: dept.code,
        location: isDemoEmployee ? "COK" : manager.location === "COK" || manager.location === "BLR" ? weighted<LocationCode>({ [manager.location]: 4, ...dept.offices }) : weighted<LocationCode>(dept.offices),
        level: "ic",
        jobTitle: isDemoEmployee ? "Flutter Developer" : pick(dept.titles.ic),
        managerId: manager.id,
        role: hrRole("ic"),
        ...(isDemoEmployee
          ? { email: `employee@${DOMAIN}`, firstName: "Sneha", lastName: "Nair", employmentType: "FULL_TIME" as const, hireDate: day(2023, 3, 13) }
          : {}),
      });
    }
  }
  return { heads };
}

/** A few leavers and a few people on long (parental) leave, never a demo user or a manager. */
function assignStatuses(): void {
  const demo = new Set([`employee@${DOMAIN}`, `manager@${DOMAIN}`, `hr@${DOMAIN}`]);
  const candidates = people.filter((p) => p.level === "ic" && !demo.has(p.email) && p.hireDate < day(2025, 1, 1));
  const shuffled = faker.helpers.shuffle(candidates);
  for (const p of shuffled.slice(0, 5)) {
    p.status = "TERMINATED";
    p.terminationDate = faker.date.between({ from: day(2025, 3, 1), to: addDays(TODAY, -30) });
    p.terminationDate = day(p.terminationDate.getUTCFullYear(), p.terminationDate.getUTCMonth() + 1, p.terminationDate.getUTCDate());
  }
  for (const p of shuffled.slice(5, 8)) {
    if (p.employmentType !== "CONTRACT") p.status = "ON_LEAVE";
  }
}

// --- Leave ----------------------------------------------------------------

interface LeaveRow {
  employeeId: number;
  leaveType: LeaveType;
  startDate: Date;
  endDate: Date;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  approverId: number | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const holidaySet = (loc: LocationCode) => new Set(YEARS.flatMap((y) => HOLIDAYS[loc][y].map(([m, d]) => iso(day(y, m, d)))));
const HOLIDAY_SETS = Object.fromEntries(LOCATIONS.map((l) => [l.code, holidaySet(l.code)])) as Record<LocationCode, Set<string>>;

function isWorkingDay(d: Date, loc: LocationCode): boolean {
  return !isWeekend(d) && !HOLIDAY_SETS[loc].has(iso(d));
}

function workingDaysBetween(start: Date, end: Date, loc: LocationCode): number {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkingDay(d, loc)) n++;
  return n;
}

/** End date that covers `workDays` working days starting at `start` (a working day). */
function endAfterWorkingDays(start: Date, workDays: number, loc: LocationCode): Date {
  let d = start;
  let counted = 1;
  while (counted < workDays) {
    d = addDays(d, 1);
    if (isWorkingDay(d, loc)) counted++;
  }
  return d;
}

function annualEntitlement(p: Person, year: number): number {
  const full = ENTITLEMENT[countryOf(p.location)].ANNUAL!;
  const scaled = p.employmentType === "PART_TIME" ? full * 0.6 : p.employmentType === "CONTRACT" ? 12 : full;
  // Joined during the year: pro-rata by the months left (rounded to half days).
  if (p.hireDate.getUTCFullYear() === year) return Math.round(((scaled * (12 - p.hireDate.getUTCMonth())) / 12) * 2) / 2;
  return scaled;
}

function entitlementFor(p: Person, type: (typeof BALANCE_TYPES)[number], year: number): number {
  if (type === "ANNUAL") return annualEntitlement(p, year);
  const full = ENTITLEMENT[countryOf(p.location)][type]!;
  return p.employmentType === "PART_TIME" ? Math.round(full * 0.6) : full;
}

function generateLeave(people: Person[], hrHeadId: number) {
  const requests: LeaveRow[] = [];
  const balances: { employeeId: number; leaveType: LeaveType; year: number; entitled: number; carriedOver: number; used: number }[] = [];

  for (const p of people) {
    const occupied = new Set<string>();
    const approverId = p.managerId ?? hrHeadId;
    const lastDay = p.terminationDate ?? day(YEARS.at(-1)!, 12, 31);
    let carry = 0;

    const add = (row: Omit<LeaveRow, "employeeId" | "approverId" | "updatedAt">) => {
      for (let d = row.startDate; d <= row.endDate; d = addDays(d, 1)) occupied.add(iso(d));
      const decided = row.status === "APPROVED" || row.status === "REJECTED";
      requests.push({ ...row, employeeId: p.id, approverId: decided || row.status === "PENDING" ? approverId : null, updatedAt: row.decidedAt ?? row.createdAt });
    };

    // People on parental leave: one long approved block around today.
    if (p.status === "ON_LEAVE") {
      const start = addDays(TODAY, -int(30, 90));
      const end = addDays(TODAY, int(30, 120));
      const createdAt = addDays(start, -int(30, 60));
      add({ leaveType: "PARENTAL", startDate: start, endDate: end, days: workingDaysBetween(start, end, p.location), reason: "Birth of a child", status: "APPROVED", decidedAt: addDays(createdAt, 2), decisionNote: null, createdAt });
    }

    for (const year of YEARS) {
      const from = maxDate(day(year, 1, 1), p.hireDate);
      const to = minDate(day(year, 12, 31), lastDay);
      if (from > to) continue;

      const allowance = { ANNUAL: entitlementFor(p, "ANNUAL", year) + carry, SICK: entitlementFor(p, "SICK", year), PERSONAL: entitlementFor(p, "PERSONAL", year) };
      const used: Record<(typeof BALANCE_TYPES)[number], number> = { ANNUAL: 0, SICK: 0, PERSONAL: 0 };

      const plan: { type: LeaveType; length: () => number }[] = [
        ...Array.from({ length: int(2, 5) }, () => ({ type: "ANNUAL" as const, length: () => pick([1, 2, 3, 5, 5, 8, 10]) })),
        ...Array.from({ length: int(0, 3) }, () => ({ type: "SICK" as const, length: () => int(1, 3) })),
        ...Array.from({ length: int(0, 2) }, () => ({ type: "PERSONAL" as const, length: () => 1 })),
        ...(chance(0.08) ? [{ type: "UNPAID" as const, length: () => int(2, 10) }] : []),
      ];

      for (const item of plan) {
        for (let attempt = 0; attempt < 12; attempt++) {
          const start = faker.date.between({ from, to });
          const startDay = day(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
          if (!isWorkingDay(startDay, p.location)) continue;
          const days = item.length();
          const end = endAfterWorkingDays(startDay, days, p.location);
          if (end > to) continue;
          // Sick leave is only ever recorded after the fact.
          if (item.type === "SICK" && end >= TODAY) continue;
          let clash = false;
          for (let d = addDays(startDay, -1); d <= addDays(end, 1); d = addDays(d, 1)) if (occupied.has(iso(d))) clash = true;
          if (clash) continue;

          const status = statusFor(item.type, startDay, end);
          const counts = status === "APPROVED" && item.type in used;
          const key = item.type as (typeof BALANCE_TYPES)[number];
          if (counts && used[key] + days > allowance[key]) break; // would overdraw the balance: skip this one

          const createdAt =
            item.type === "SICK" ? addDays(startDay, int(0, 1)) : minDate(addDays(startDay, -int(5, 45)), addDays(TODAY, -int(0, 6)));
          const decidedAt = status === "APPROVED" || status === "REJECTED" ? minDate(addDays(createdAt, int(0, 3)), TODAY) : status === "CANCELLED" ? minDate(addDays(createdAt, int(1, 10)), TODAY) : null;

          add({
            leaveType: item.type,
            startDate: startDay,
            endDate: end,
            days,
            reason: chance(0.85) ? pick(REASONS[item.type] ?? ["Personal"]) : null,
            status,
            decidedAt,
            decisionNote: status === "REJECTED" ? pick(REJECTION_NOTES) : null,
            createdAt,
          });
          if (counts) used[key] += days;
          break;
        }
      }

      for (const type of BALANCE_TYPES) {
        balances.push({
          employeeId: p.id,
          leaveType: type,
          year,
          entitled: type === "ANNUAL" ? allowance.ANNUAL - carry : allowance[type],
          carriedOver: type === "ANNUAL" ? carry : 0,
          used: used[type],
        });
      }
      carry = Math.min(MAX_CARRY_OVER, Math.max(0, allowance.ANNUAL - used.ANNUAL));
    }
  }
  return { requests, balances };
}

function statusFor(type: LeaveType, start: Date, end: Date): LeaveStatus {
  if (type === "SICK") return "APPROVED";
  if (end < TODAY) return weighted<LeaveStatus>({ APPROVED: 90, REJECTED: 5, CANCELLED: 5 });
  if (start <= TODAY) return "APPROVED"; // on leave right now
  return weighted<LeaveStatus>({ PENDING: 45, APPROVED: 50, CANCELLED: 5 });
}

/** Guarantees the demo accounts have something interesting to look at. */
function demoLeave(employee: Person, manager: Person, requests: LeaveRow[]): void {
  const nextWorkingDay = (from: Date) => {
    let d = from;
    while (!isWorkingDay(d, employee.location)) d = addDays(d, 1);
    return d;
  };
  const busy = (p: Person, s: Date, e: Date) =>
    requests.some((r) => r.employeeId === p.id && r.status !== "CANCELLED" && r.status !== "REJECTED" && r.startDate <= e && r.endDate >= s);

  // A pending request from the demo employee, waiting on the demo manager.
  let start = nextWorkingDay(addDays(TODAY, 24));
  while (busy(employee, start, endAfterWorkingDays(start, 3, employee.location))) start = nextWorkingDay(addDays(start, 7));
  const end = endAfterWorkingDays(start, 3, employee.location);
  const createdAt = addDays(TODAY, -2);
  requests.push({ employeeId: employee.id, leaveType: "ANNUAL", startDate: start, endDate: end, days: 3, reason: "Cousin's wedding in Thrissur", status: "PENDING", approverId: manager.id, decidedAt: null, decisionNote: null, createdAt, updatedAt: createdAt });
}

// --- Pay ------------------------------------------------------------------

function computePay(country: Country, monthlyBase: number, allowances: number, bonus: number) {
  const gross = monthlyBase + allowances + bonus;
  let tax = 0;
  let deductions = 0;
  if (country === "IN") {
    const annualGross = gross * 12;
    const rate = annualGross <= 1_200_000 ? 0.05 : annualGross <= 2_400_000 ? 0.15 : 0.25; // simplified slabs
    tax = gross * rate;
    deductions = monthlyBase * 0.12 + 200; // provident fund + professional tax
  } else if (country === "GB") {
    const annual = gross * 12;
    const allowance = 12_570;
    const basic = Math.max(0, Math.min(annual, 50_270) - allowance);
    const higher = Math.max(0, annual - 50_270);
    const incomeTax = basic * 0.2 + higher * 0.4;
    const ni = basic * 0.08 + higher * 0.02;
    tax = (incomeTax + ni) / 12;
    deductions = monthlyBase * 0.05; // workplace pension
  }
  // AE: no income tax, no employee deductions.
  // Round each figure first, then derive the totals from the rounded ones, so
  // gross = base + allowances + bonus and net = gross - tax - deductions hold to the cent.
  const grossPay = round2(gross);
  const taxR = round2(tax);
  const deductionsR = round2(deductions);
  return { grossPay, tax: taxR, deductions: deductionsR, netPay: round2(grossPay - taxR - deductionsR) };
}

function generatePayslips(people: Person[]) {
  const currencyOf = (code: LocationCode) => LOCATIONS.find((l) => l.code === code)!.currency;
  const rows = [];
  for (const p of people) {
    const country = countryOf(p.location);
    let annual = p.annualSalary / (1.05 * 1.05); // salary today is after two yearly raises
    for (const year of YEARS) {
      for (let month = 1; month <= 12; month++) {
        if (month === 4) annual = annual * 1.05; // April raise
        const periodStart = day(year, month, 1);
        const periodEnd = addDays(day(year, month + 1, 1), -1);
        const payDate = day(year, month, 25);
        if (payDate > TODAY) continue;
        if (periodEnd < p.hireDate) continue;
        if (p.terminationDate && periodStart > p.terminationDate) continue;

        // Partial first/last month: pay for the days actually employed.
        const daysInMonth = periodEnd.getUTCDate();
        const workedFrom = maxDate(periodStart, p.hireDate);
        const workedTo = p.terminationDate ? minDate(periodEnd, p.terminationDate) : periodEnd;
        const fraction = ((workedTo.getTime() - workedFrom.getTime()) / DAY_MS + 1) / daysInMonth;

        const partTime = p.employmentType === "PART_TIME" ? 0.6 : 1;
        const basePay = round2((annual / 12) * partTime * fraction);
        const allowanceRate = country === "AE" ? 0.3 : country === "IN" ? 0.25 : 0;
        const londonWeighting = p.location === "LON" ? 250 * fraction : 0;
        const allowances = round2(basePay * allowanceRate + londonWeighting);
        const bonus = month === 3 && p.employmentType !== "CONTRACT" && periodStart > p.hireDate && chance(0.55) ? round2(annual * faker.number.float({ min: 0.04, max: 0.15 })) : 0;

        rows.push({
          employeeId: p.id,
          periodStart,
          periodEnd,
          payDate,
          currency: currencyOf(p.location),
          basePay,
          allowances,
          bonus,
          ...computePay(country, basePay, allowances, bonus),
        });
      }
    }
  }
  return rows;
}

// --- Benefits -------------------------------------------------------------

const BENEFIT_PLANS: {
  code: string;
  name: string;
  category: BenefitCategory;
  provider: string;
  description: string;
  costs: [number, number, number];
  currency: string;
  countries: Country[];
}[] = [
  { code: "HLT-AE", name: "UAE Health Essential", category: "HEALTH", provider: "Gulf Shield Health", description: "Inpatient and outpatient cover across the UAE, 10% co-pay on outpatient visits, maternity included.", costs: [0, 450, 1200], currency: "AED", countries: ["AE"] },
  { code: "HLT-IN", name: "India Group Mediclaim", category: "HEALTH", provider: "Malabar Care Insurance", description: "Hospitalisation cover up to INR 5,00,000 per family per year, cashless at network hospitals.", costs: [0, 600, 1500], currency: "INR", countries: ["IN"] },
  { code: "HLT-GB", name: "UK Private Medical", category: "HEALTH", provider: "Albion Health", description: "Private medical insurance with fast-track diagnostics and mental health support.", costs: [0, 45, 95], currency: "GBP", countries: ["GB"] },
  { code: "DEN-AE", name: "UAE Dental Plus", category: "DENTAL", provider: "Gulf Shield Health", description: "Routine check-ups, cleaning and 50% of major dental work up to AED 5,000 a year.", costs: [60, 120, 220], currency: "AED", countries: ["AE"] },
  { code: "DEN-GB", name: "UK Dental Cover", category: "DENTAL", provider: "Albion Health", description: "Check-ups, hygienist visits and emergency treatment.", costs: [12, 22, 38], currency: "GBP", countries: ["GB"] },
  { code: "VIS-GB", name: "UK Vision Care", category: "VISION", provider: "ClearSight", description: "Annual eye test and GBP 150 towards glasses or contact lenses.", costs: [5, 9, 14], currency: "GBP", countries: ["GB"] },
  { code: "LIFE", name: "Group Life Cover", category: "LIFE", provider: "Meridian Life", description: "Life cover of 4x annual base salary, fully paid by the company.", costs: [0, 0, 0], currency: "USD", countries: ["AE", "IN", "GB"] },
  { code: "RET-GB", name: "UK Workplace Pension", category: "RETIREMENT", provider: "Thames Pension Trust", description: "Auto-enrolment pension: you pay 5% of base pay, the company adds 5%.", costs: [0, 0, 0], currency: "GBP", countries: ["GB"] },
  { code: "RET-IN", name: "Corporate NPS", category: "RETIREMENT", provider: "National Pension System", description: "Voluntary pension: the company contributes up to 10% of base pay, tax-deductible.", costs: [0, 0, 0], currency: "INR", countries: ["IN"] },
];

function generateEnrollments(people: Person[], planIds: Map<string, number>) {
  const rows = [];
  for (const p of people) {
    if (p.employmentType === "CONTRACT") continue; // contractors aren't eligible
    const country = countryOf(p.location);
    const coverage = weighted<CoverageLevel>({ EMPLOYEE_ONLY: 45, EMPLOYEE_SPOUSE: 20, FAMILY: 35 });
    const dependents = coverage === "EMPLOYEE_ONLY" ? 0 : coverage === "EMPLOYEE_SPOUSE" ? 1 : int(2, 4);
    for (const plan of BENEFIT_PLANS) {
      if (!plan.countries.includes(country)) continue;
      const always = plan.category === "HEALTH" || plan.category === "LIFE" || plan.code === "RET-GB";
      if (!always && !chance(plan.code === "RET-IN" ? 0.4 : 0.6)) continue;
      const perPerson = plan.category === "LIFE" || plan.category === "RETIREMENT";
      rows.push({
        employeeId: p.id,
        planId: planIds.get(plan.code)!,
        coverageLevel: perPerson ? ("EMPLOYEE_ONLY" as const) : coverage,
        dependents: perPerson ? 0 : dependents,
        startDate: p.hireDate,
        endDate: p.terminationDate,
      });
    }
  }
  return rows;
}

// --- Main -----------------------------------------------------------------

async function main() {
  const prisma = createPrisma();
  const started = Date.now();

  // Start from empty tables so the seed can be re-run. RESTART IDENTITY resets the id counters.
  await prisma.$executeRawUnsafe(
    `TRUNCATE benefit_enrollments, benefit_plans, payslips, holidays, leave_requests, leave_balances, employees, departments, locations RESTART IDENTITY CASCADE`,
  );

  // Reference data
  await prisma.location.createMany({ data: LOCATIONS.map((l) => ({ ...l })) });
  const locationIds = new Map((await prisma.location.findMany()).map((l) => [l.code, l.id]));
  await prisma.department.createMany({ data: DEPARTMENTS.map((d) => ({ code: d.code, name: d.name })) });
  const departmentIds = new Map((await prisma.department.findMany()).map((d) => [d.code, d.id]));
  await prisma.holiday.createMany({
    data: LOCATIONS.flatMap((l) => YEARS.flatMap((y) => HOLIDAYS[l.code][y].map(([m, d, name]) => ({ locationId: locationIds.get(l.code)!, date: day(y, m, d), name })))),
  });

  // People. Ids are assigned here (so managers can be referenced before insert),
  // then the id sequence is moved past them so the API can create new rows later.
  const { heads } = buildOrg();
  assignStatuses();
  const passwordHash = await hashPassword(DEMO_PASSWORD); // one hash shared by every seeded account: fine for demo data, keeps seeding fast
  await prisma.employee.createMany({
    data: people.map((p) => ({
      id: p.id,
      employeeCode: p.employeeCode,
      email: p.email,
      passwordHash,
      firstName: p.firstName,
      lastName: p.lastName,
      jobTitle: p.jobTitle,
      phone: p.phone,
      role: p.role,
      employmentType: p.employmentType,
      status: p.status,
      hireDate: p.hireDate,
      terminationDate: p.terminationDate,
      departmentId: departmentIds.get(p.departmentCode)!,
      locationId: locationIds.get(p.location)!,
      managerId: p.managerId,
    })),
  });
  await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('employees', 'id'), (SELECT MAX(id) FROM employees))`);
  for (const [code, headId] of heads) await prisma.department.update({ where: { code }, data: { headId } });

  // Leave
  const { requests, balances } = generateLeave(people, heads.get("HR")!);
  demoLeave(people.find((p) => p.email === `employee@${DOMAIN}`)!, people.find((p) => p.email === `manager@${DOMAIN}`)!, requests);
  await prisma.leaveBalance.createMany({ data: balances });
  await prisma.leaveRequest.createMany({ data: requests });

  // Pay
  const payslips = generatePayslips(people);
  await prisma.payslip.createMany({ data: payslips });

  // Benefits
  await prisma.benefitPlan.createMany({
    data: BENEFIT_PLANS.map(({ costs, ...plan }) => ({ ...plan, costEmployeeOnly: costs[0], costEmployeeSpouse: costs[1], costFamily: costs[2] })),
  });
  const planIds = new Map((await prisma.benefitPlan.findMany()).map((p) => [p.code, p.id]));
  const enrollments = generateEnrollments(people, planIds);
  await prisma.benefitEnrollment.createMany({ data: enrollments });

  const holidays = await prisma.holiday.count();
  console.log(
    `Seeded in ${Date.now() - started} ms (today = ${iso(TODAY)}):\n` +
      `  ${LOCATIONS.length} locations, ${DEPARTMENTS.length} departments, ${holidays} holidays\n` +
      `  ${people.length} employees (${people.filter((p) => p.status === "TERMINATED").length} terminated, ${people.filter((p) => p.status === "ON_LEAVE").length} on leave)\n` +
      `  ${balances.length} leave balances, ${requests.length} leave requests\n` +
      `  ${payslips.length} payslips, ${BENEFIT_PLANS.length} benefit plans, ${enrollments.length} enrollments\n` +
      `Demo logins (password "${DEMO_PASSWORD}"): employee@${DOMAIN}, manager@${DOMAIN}, hr@${DOMAIN}`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
