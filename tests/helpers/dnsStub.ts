import { createSocket, type Socket } from "node:dgram";
import type { AddressInfo } from "node:net";

const TYPE_A = 1;
const TYPE_CNAME = 5;
const TYPE_MX = 15;
const TYPE_TXT = 16;

export interface DnsRecords {
  a?: Map<string, string[]>;
  cname?: Map<string, string>;
  mx?: Map<string, string[]>;
  txt?: Map<string, string[]>;
  nxdomain?: Set<string>;
  servfail?: Set<string>;
}

export interface DnsStub {
  server: string;
  close(): void;
}

function encodeName(name: string): Buffer {
  return Buffer.concat([
    ...name.split(".").map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    Buffer.from([0]),
  ]);
}

function rdataFor(records: DnsRecords, name: string, type: number): Array<{ type: number; rdata: Buffer }> {
  const cname = records.cname?.get(name);
  if (cname && (type === TYPE_CNAME || type === TYPE_A || type === TYPE_TXT || type === TYPE_MX)) {
    return type === TYPE_CNAME ? [{ type: TYPE_CNAME, rdata: encodeName(cname) }] : [];
  }
  if (type === TYPE_A) {
    return (records.a?.get(name) ?? []).map((ip) => ({ type, rdata: Buffer.from(ip.split(".").map(Number)) }));
  }
  if (type === TYPE_TXT) {
    return (records.txt?.get(name) ?? []).map((text) => ({
      type,
      rdata: Buffer.concat([Buffer.from([text.length]), Buffer.from(text)]),
    }));
  }
  if (type === TYPE_MX) {
    return (records.mx?.get(name) ?? []).map((exchange, index) => ({
      type,
      rdata: Buffer.concat([Buffer.from([0, (index + 1) * 10]), encodeName(exchange)]),
    }));
  }
  return [];
}

/**
 * Servidor DNS real por UDP: el código bajo prueba resuelve de verdad, como con
 * los servidores HTTP locales de los demás tests. Un nombre que no aparece existe
 * pero no tiene registros, salvo que esté en `nxdomain` o `servfail`.
 */
export async function startDnsStub(records: DnsRecords): Promise<DnsStub> {
  const socket: Socket = createSocket("udp4");

  socket.on("message", (query, remote) => {
    const labels: string[] = [];
    let offset = 12;
    while (query[offset] !== 0) {
      const length = query[offset]!;
      labels.push(query.subarray(offset + 1, offset + 1 + length).toString());
      offset += length + 1;
    }
    const type = query.readUInt16BE(offset + 1);
    const questionEnd = offset + 5;
    const name = labels.join(".").toLowerCase();

    const answers = rdataFor(records, name, type);
    const rcode = records.servfail?.has(name) ? 2 : records.nxdomain?.has(name) ? 3 : 0;

    const header = Buffer.alloc(12);
    query.copy(header, 0, 0, 2);
    header.writeUInt16BE(0x8180 | rcode, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(rcode === 0 ? answers.length : 0, 6);

    const parts = [header, query.subarray(12, questionEnd)];
    if (rcode === 0) {
      for (const answer of answers) {
        const fixed = Buffer.alloc(12);
        fixed.writeUInt16BE(0xc00c, 0);
        fixed.writeUInt16BE(answer.type, 2);
        fixed.writeUInt16BE(1, 4);
        fixed.writeUInt32BE(60, 6);
        fixed.writeUInt16BE(answer.rdata.length, 10);
        parts.push(fixed, answer.rdata);
      }
    }
    socket.send(Buffer.concat(parts), remote.port, remote.address);
  });

  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
  return {
    server: `127.0.0.1:${(socket.address() as AddressInfo).port}`,
    close: () => socket.close(),
  };
}
