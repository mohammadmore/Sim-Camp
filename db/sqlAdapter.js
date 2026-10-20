/**
 * SQL Adapter Template
 * 
 * To switch to your own SQL database (MySQL, PostgreSQL, etc.):
 * 1. Install an SQL query builder or ORM (e.g., `npm install knex mysql2`)
 * 2. Configure your connection pool here.
 * 3. Implement the functions below using your SQL client.
 * 4. Set the environment variable `DB_ADAPTER=sql` on your host.
 */

// Example placeholder for SQL connection
// import knex from 'knex';
// const db = knex({ client: 'mysql2', connection: process.env.DATABASE_URL });

export default {
    async getCamp(id) {
        throw new Error("getCamp not implemented in SQL adapter yet.");
        // Example:
        // const camp = await db('camps').where({ id }).first();
        // return camp;
    },

    async updateCamp(id, data) {
        throw new Error("updateCamp not implemented in SQL adapter yet.");
        // Example:
        // const exists = await db('camps').where({ id }).first();
        // if (exists) await db('camps').where({ id }).update(data);
        // else await db('camps').insert({ id, ...data });
    },

    async getSetting(key) {
        throw new Error("getSetting not implemented in SQL adapter yet.");
        // Example:
        // const setting = await db('settings').where({ key }).first();
        // return setting ? setting.value : null;
    },

    async setSetting(key, value) {
        throw new Error("setSetting not implemented in SQL adapter yet.");
        // Example:
        // await db('settings').insert({ key, value }).onConflict('key').merge();
    },

    async getAllCamps() {
        throw new Error("getAllCamps not implemented in SQL adapter yet.");
        // Example:
        // return await db('camps').select('id', 'orgName', 'title', 'locked', 'campType');
    }
};
