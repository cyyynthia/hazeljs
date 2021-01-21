/*
 * Copyright (c) 2021 Cynthia K. Rey, All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { inspect } from 'util'

const PACKED_INT_LENGTH = [
  Math.pow(2, 7),
  Math.pow(2, 14),
  Math.pow(2, 21),
  Math.pow(2, 28)
]

export type HazelMessage = { tag: number, data: HazelBuffer }

export class HazelBuffer {
  constructor (private readonly buf: Buffer) {}

  get length () {
    return this.buf.length
  }

  readByte (offset?: number): number {
    return this.buf.readUInt8(offset)
  }

  writeByte (byte: number, offset?: number): number {
    return this.buf.writeUInt8(byte, offset)
  }

  readBoolean (offset?: number): boolean {
    return this.buf.readUInt8(offset) === 1
  }

  writeBoolean (bool: boolean, offset?: number): number {
    return this.buf.writeUInt8(bool ? 1 : 0, offset)
  }

  readSByte (offset?: number): number {
    return this.buf.readInt8(offset)
  }

  writeSByte (byte: number, offset?: number): number {
    return this.buf.writeInt8(byte, offset)
  }

  readInt16 (offset?: number): number {
    return this.buf.readInt16BE(offset)
  }

  writeInt16 (short: number, offset?: number): number {
    return this.buf.writeInt16BE(short, offset)
  }

  readUInt16 (offset?: number): number {
    return this.buf.readUInt16BE(offset)
  }

  writeUInt16 (short: number, offset?: number): number {
    return this.buf.writeUInt16BE(short, offset)
  }

  readInt32 (offset?: number): number {
    return this.buf.readInt32BE(offset)
  }

  writeInt32 (int: number, offset?: number): number {
    return this.buf.writeInt32BE(int, offset)
  }

  readUInt32 (offset?: number): number {
    return this.buf.readUInt32BE(offset)
  }

  writeUInt32 (int: number, offset?: number): number {
    return this.buf.writeUInt32BE(int, offset)
  }

  readPackedInt32 (offset?: number): number {
    const res = this.readPackedUInt32(offset)
    return res & 1 ? (res + 1) / -2 : res / 2
  }

  writePackedInt32 (int: number, offset?: number) {
    return this.writePackedUInt32(int >= 0 ? (int * 2) : ((int * -2) - 1), offset)
  }

  readPackedUInt32 (offset: number = 0): number {
    let res = 0
    let shift = 0
    let cursor = offset
    let byte: number

    do {
      if (cursor >= this.buf.length || shift > 21) throw new RangeError('Could not decode varint')
      byte = this.buf.readUInt8(cursor++)
      res += (byte & 0x7F) << shift
      shift += 7
    } while (byte >= 0x80)

    return res
  }

  writePackedUInt32 (int: number, offset: number = 0) {
    let cursor = 0

    while (int & -0x80) {
      this.buf.writeUInt8((int & 0xff) | 0x80, offset + cursor++)
      int >>>= 7
    }

    this.buf.writeUInt8(int | 0, offset + cursor)
    return cursor
  }

  readString (offset: number = 0): string {
    const len = this.readPackedUInt32(offset)
    const read = HazelBuffer.getPackedUInt32Size(len)
    const strBuf = this.buf.slice(offset + read, offset + read + len)
    return strBuf.toString('utf8')
  }

  writeString (str: string, offset: number = 0): number {
    const strBuf = Buffer.from(str, 'utf8')
    const len = this.writePackedUInt32(strBuf.length, offset)
    strBuf.copy(this.buf, offset + len)
    return len + strBuf.length
  }

  readIPv4 (offset: number = 0): string {
    return Array.from(this.buf.slice(offset, offset + 4)).join('.')
  }

  writeIPv4 (address: string, offset: number = 0): number {
    const parts = address.split('.').map(Number)
    parts.forEach((part, i) => this.buf.writeUInt8(part, offset + i))
    return 4
  }

  readHazelMessage (offset: number = 0): HazelMessage {
    const length = this.buf.readUInt16BE(offset)
    const tag = this.buf.readUInt8(offset + 2)
    const data = this.buf.slice(offset + 3, offset + 3 + length)
    return { tag: tag, data: new HazelBuffer(data) }
  }

  writeHazelMessage (message: HazelMessage, offset?: number): number {
    offset = offset ?? 0
    this.buf.writeUInt16BE(message.data.length, offset)
    this.buf.writeUInt8(message.tag, offset + 2)
    message.data.copy(this.buf, offset + 3)
    return 3 + message.data.length
  }

  writeBuffer (buf: HazelBuffer | Buffer, offset?: number) {
    const src = 'toBuffer' in buf ? buf.toBuffer() : buf
    src.copy(this.buf, offset)
  }

  slice (begin?: number, end?: number): HazelBuffer {
    return new HazelBuffer(this.buf.slice(begin, end))
  }

  copy (target: Buffer, targetStart?: number, sourceStart?: number, sourceEnd?: number): number {
    return this.buf.copy(target, targetStart, sourceStart, sourceEnd)
  }

  toBuffer (): Buffer {
    return this.buf
  }

  static getPackedInt32Size (int: number) {
    return HazelBuffer.getPackedUInt32Size(int >= 0 ? (int * 2) : ((int * -2) - 1))
  }

  static getPackedUInt32Size (int: number) {
    return PACKED_INT_LENGTH.findIndex((b) => b > int) + 1 || PACKED_INT_LENGTH.length
  }

  static alloc (size: number): HazelBuffer {
    return new HazelBuffer(Buffer.alloc(size))
  }

  [inspect.custom]() {
    const res = inspect(this.buf)
    res.replace('Buffer', 'HazelBuffer')
  }
}
