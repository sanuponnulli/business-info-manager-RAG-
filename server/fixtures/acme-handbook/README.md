# Acme Employee Handbook (demo content)

`handbook.html` is the source of `../acme-employee-handbook.pdf`: a fictional
31-page handbook for the demo company in the HR database. Its numbers match
`prisma/seed.ts` (leave entitlements and carry-over, 2026 holidays per office,
payday, allowances and deductions, benefit plans and their costs), so policy
answers from the handbook agree with each person's own HR data.

Rebuild the PDF after editing the HTML (from `server/`):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --no-pdf-header-footer \
  --print-to-pdf=fixtures/acme-employee-handbook.pdf "file://$PWD/fixtures/acme-handbook/handbook.html"
```

Upload it (server running, from `server/`):

```bash
set -a; source .env; set +a
curl -X POST localhost:3000/api/v1/admin/documents -H "x-admin-key: $ADMIN_API_KEY" \
  -F file=@fixtures/acme-employee-handbook.pdf -F docId=acme-employee-handbook -F "title=Acme Employee Handbook 2026"
```
