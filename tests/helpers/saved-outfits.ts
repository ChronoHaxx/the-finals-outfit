// Test doubles for saved outfits: a Web Storage stand-in and a debounce timer that only fires when told to.

export function memoryStorage(options: { failWrites?: boolean } = {}): Storage & { keys(): string[] } {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options.failWrites) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
      data.set(key, String(value));
    },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    keys: () => [...data.keys()],
  };
}

export function manualScheduler() {
  let tasks: (() => void)[] = [];
  return {
    schedule: (run: () => void) => {
      tasks.push(run);
      return () => { tasks = tasks.filter(task => task !== run); };
    },
    get pending() { return tasks.length; },
    runAll() { const due = tasks; tasks = []; for (const task of due) task(); },
  };
}
