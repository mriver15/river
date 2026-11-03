// Persisted simulation deadlines, ordered by (dueTick, priority, insertion sequence).
export interface Job { id: number; dueTick: number; priority: number; type: string; payload: Record<string, unknown> }

export class Scheduler {
  jobs: Job[] = [];
  nextId = 1;
  schedule(dueTick: number, type: string, payload: Record<string, unknown> = {}, priority = 0): number {
    const job = { id: this.nextId++, dueTick, priority, type, payload };
    this.jobs.push(job);
    this.jobs.sort((a, b) => a.dueTick - b.dueTick || a.priority - b.priority || a.id - b.id);
    return job.id;
  }
  cancel(id: number) { this.jobs = this.jobs.filter((j) => j.id !== id); }
  /** Remove and return every job due at or before `tick`, in order. */
  due(tick: number): Job[] {
    const n = this.jobs.findIndex((j) => j.dueTick > tick);
    return this.jobs.splice(0, n === -1 ? this.jobs.length : n);
  }
  save() { return { nextId: this.nextId, jobs: this.jobs.map((j) => ({ ...j, payload: { ...j.payload } })) }; }
  static restore(s: { nextId: number; jobs: Job[] }) { const x = new Scheduler(); x.nextId = s.nextId; x.jobs = s.jobs.map((j) => ({ ...j })); return x; }
}
