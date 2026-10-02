# hh-di: Homeroom Heroes teacher flow, inject -> run -> assert

Node v22.22.0, no npm deps. Run from this directory:

    node --experimental-strip-types --test teacher.test.ts                    # reference
    HH_IMPL=mutantA node --experimental-strip-types --test teacher.test.ts
    HH_IMPL=mutantB node --experimental-strip-types --test teacher.test.ts
    HH_IMPL=mutantC node --experimental-strip-types --test teacher.test.ts

Files: ../board.ts (ChainSpot PxC board, verbatim except the './contract' type import),
teacher.ts (reference fn.Teacher.register/approve/createProfile/pickOfDay + steps),
mutants.ts (live-site mutants + HH_IMPL selector), pick-worker.ts (runs pickOfDay in a
worker so an infinite loop can be killed), teacher.test.ts (10 tests).

## Results (real output)

| HH_IMPL   | pass | fail | failing tests                                   |
|-----------|------|------|-------------------------------------------------|
| reference | 10   | 0    | none                                            |
| mutantA   | 8    | 2    | #6, #7 (A)                                      |
| mutantB   | 8    | 2    | #8, #9 (B)                                      |
| mutantC   | 9    | 1    | #10 (C): "did not return within 2s (infinite loop)" |

Each mutant fails only its own tests; the 5 ordinary cases pass on all four.

## Mutants (what they copy from Engsmallz/hithero app.py)
- mutantA: move_user checks the approver's TeacherList row (profile), and
  create_teacher_profile stores the retyped state/county/district. Caught by (A).
- mutantB: aa_link = wishlist + "&tag=h0mer00mher0-20", no validation. Caught by (B):
  non-Amazon URL accepted; ".../ls/3ABC&tag=..." puts the tag in the path, no tag param.
- mutantC: fetch_teacher_for_tod's `while True` random redraw. Caught by (C): worker
  is terminated after 2s; node:test timeout is 5s.

## Notes
- Live move_user copies only email/password/role/phone into registered_users, so the
  live approved record has no district at all; the reference keeps it on the record.
- Live admins may create multiple profiles (create_count==0 or admin); the reference
  applies "once per account" to everyone, as specified.
