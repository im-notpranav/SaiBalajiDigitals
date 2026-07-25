const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:1234@localhost:5432/postgres'
  });
  
  await client.connect();
  
  // Terminate all other connections to the database
  await client.query(`
    SELECT pg_terminate_backend(pid) 
    FROM pg_stat_activity 
    WHERE datname = 'sbd_oms' AND pid <> pg_backend_pid();
  `);
  
  console.log("Terminated all connections to sbd_oms");
  
  await client.end();
}

main().catch(console.error);
