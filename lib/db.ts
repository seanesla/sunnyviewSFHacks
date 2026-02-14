// lib/db.ts
import Dexie, { type EntityTable } from 'dexie';
import { z } from 'zod';
import { ProjectCreateSchema } from './schemas';

// Define the shape of a Project for TS
type Project = z.infer<typeof ProjectCreateSchema> & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  // We store geometry/results here too
  geometry?: any;
  results?: any;
};

// Initialize Dexie (IndexedDB)
const db = new Dexie('SunnyviewDB') as Dexie & {
  projects: EntityTable<Project, 'id'>;
};

// Schema syntax is for indexing, not validation
db.version(1).stores({
  projects: 'id, title, createdAt' 
});

export { db };