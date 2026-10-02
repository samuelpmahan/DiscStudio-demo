// Runs ONE pickOfDay step on a fresh board in a worker thread, so a
// synchronous infinite loop (mutant C) can be killed by the test's timeout.
import { parentPort, workerData } from 'node:worker_threads';
import { createExecBoard } from '../board.ts';
import { selectedCalculations } from './mutants.ts';
import { registerTeacher, Teacher, TeacherPxC } from './teacher.ts';

const pxc = createExecBoard();
registerTeacher(pxc, selectedCalculations(workerData.impl));
pxc.set(TeacherPxC.now, workerData.now);
pxc.set(TeacherPxC.profiles, workerData.profiles);
const pick = Teacher.pickOfDay(pxc);
parentPort!.postMessage({ pick, profiles: pxc.get(TeacherPxC.profiles) });
