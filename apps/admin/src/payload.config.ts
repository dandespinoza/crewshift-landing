import path from 'path'
import { fileURLToPath } from 'url'
import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import sharp from 'sharp'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    meta: {
      titleSuffix: '- CrewShift Admin',
      title: 'CrewShift Admin',
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
    theme: 'dark',
  },

  collections: [
    {
      slug: 'users',
      auth: true,
      admin: {
        useAsTitle: 'email',
      },
      fields: [
        {
          name: 'firstName',
          type: 'text',
        },
        {
          name: 'lastName',
          type: 'text',
        },
        {
          name: 'role',
          type: 'select',
          options: [
            { label: 'Super Admin', value: 'super-admin' },
            { label: 'Admin', value: 'admin' },
            { label: 'Viewer', value: 'viewer' },
          ],
          defaultValue: 'viewer',
          required: true,
        },
      ],
    },
  ],

  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL ?? '',
    },
    schemaName: 'payload',
    push: false,
  }),

  editor: lexicalEditor(),

  secret: process.env.PAYLOAD_SECRET ?? 'default-secret-change-me',

  sharp,

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
