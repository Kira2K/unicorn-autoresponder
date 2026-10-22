import { prepareOwner, verifyOnOwner } from './owner.mts';
import { failureFields } from './contract.mts';
const [command, file, preflightPath, ...extra] = process.argv.slice(2);
try {
  if (command === 'prepare' && file && !preflightPath && !extra.length) {
    const result = await prepareOwner(file); console.log(JSON.stringify({ prepared: true, id: result.id, machine: result.machine }));
  } else if (command === 'verify' && file?.endsWith('.request.json') && preflightPath && !extra.length) {
    const proof = await verifyOnOwner({ requestPath: file, preflightPath });
    console.log(JSON.stringify(proof)); if (!proof.passed) process.exitCode = 1;
  } else throw Object.assign(new Error(), { code: 'archive_usage_owner_prepare_or_verify' });
} catch (error) { console.log(JSON.stringify({ passed: false, ...failureFields(error) })); process.exitCode = 1; }
