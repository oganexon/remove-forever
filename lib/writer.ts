import { uuid, hash, path } from "./deps.ts";
import { logger } from "./logger.ts";

export class FileWriter {
  /** Changes the buffer that will be written to the file.
   * This method should be overwritten. */
  static getValues(p: Uint8Array): void {}

  /** Retrieves information about the file.
   * This function is mandatory. */
  static async init(path: string): Promise<FileData> {
    logger.start(path, "file");
    const fileInfo = await Deno.stat(path);

    if (fileInfo.isFile === false) {
      throw new Error("The specified path is not a file.");
    }

    const { size } = fileInfo;
    const checksum = new hash.Sha256();
    const verifyChecksum = false;

    return { path, size, checksum, verifyChecksum };
  }

  /** Writes the buffer to the file.
   * The data is copied from a custom Reader. */
  static async write(fileData: FileData, data?: any) {
    const dest = await Deno.open(fileData.path, { write: true });
    const { getValues } = this;
    let { size } = fileData;

    const src: Deno.Reader = {
      read(p: Uint8Array): Promise<number | null> {
        return new Promise((resolve) => {
          const length = Math.min(p.byteLength, size);
          size -= length;

          if (length === 0) {
            resolve(null);
          } else {
            getValues(p);
            if (fileData.verifyChecksum) {
              fileData.checksum.update(p.slice(0, length));
            }
            resolve(length);
          }
        });
      },
    };

    await Deno.copy(src, dest);
    dest.close();

    if (fileData.verifyChecksum) {
      fileData.verifyChecksum = false;
      await this.verify(fileData);
    }
  }

  /** Checks that the file was correctly written.
   * Will read the file and compares the checksums. */
  static verifyNext(fileData: FileData) {
    fileData.verifyChecksum = true;
    fileData.checksum = new hash.Sha256();
  }

  /** For internal use only */
  static async verify(fileData: FileData) {
    logger.debug(fileData.path, "file", "Checksum verification");

    const src = await Deno.open(fileData.path, { read: true });
    const checksum = new hash.Sha256();

    for await (const chunk of Deno.iter(src)) {
      checksum.update(chunk);
    }
    src.close();

    if (fileData.checksum.hex() !== checksum.hex()) {
      return new Error("Invalid checksum");
    }
  }
}

/** Writes cryptographically strong pseudo-random data. */
export class Random extends FileWriter {
  static getValues(p: Uint8Array): void {
    crypto.getRandomValues(p);
  }

  static async write(fileData: FileData) {
    logger.debug(fileData.path, "file", "Randomizing");
    await super.write(fileData);
  }
}

/** Writes one cryptographically strong pseudo-random byte on the whole file. */
export class RandomByte extends FileWriter {
  static getValues(p: Uint8Array): void {
    const byte = new Uint8Array(1);
    crypto.getRandomValues(byte);
    p.fill(byte[0]);
  }

  static async write(fileData: FileData) {
    logger.debug(fileData.path, "file", "RandomByte");
    await super.write(fileData);
  }
}

/** Writes zeros on the whole file. */
export class Zero extends FileWriter {
  static getValues(p: Uint8Array): void {
    p.fill(0x000000);
  }

  static async write(fileData: FileData) {
    logger.debug(fileData.path, "file", "Zero");
    await super.write(fileData);
  }
}

/** Writes ones on the whole file. */
export class One extends FileWriter {
  static getValues(p: Uint8Array): void {
    p.fill(0xFFFFFF);
  }

  static async write(fileData: FileData) {
    logger.debug(fileData.path, "file", "One");
    await super.write(fileData);
  }
}

/** Writes one byte on the whole file. */
export class Byte extends FileWriter {
  static async write(fileData: FileData, byte: number) {
    logger.debug(fileData.path, "file", `Byte: ${byte}`);
    this.getValues = function (p: Uint8Array) {
      p.fill(byte);
    };
    await super.write(fileData);
  }
}

/** Writes an array of bytes on the whole file. */
export class ByteArray extends FileWriter {
  static async write(fileData: FileData, byteArray: number[]) {
    logger.debug(fileData.path, "file", `ByteArray: ${byteArray}`);
    const { length } = byteArray;
    this.getValues = function (p: Uint8Array) {
      for (let i = 0; i < p.length; i++) {
        p[i] = byteArray[i % length];
      }
    };
    await super.write(fileData);
  }
}

/** Changes different file properties. */
export class FileProperties {
  /** Renames the file to a random string (uuid v4). */
  static async rename(fileData: FileData) {
    logger.debug(fileData.path, "file", "Renaming");
    const newName = uuid.v4.generate();
    const newPath = path.join(path.dirname(fileData.path), newName);
    await Deno.rename(fileData.path, newPath);
    fileData.path = newPath;
  }

  /** Truncates to between 25% and 75% of the file size. */
  static async truncate(fileData: FileData) {
    logger.debug(fileData.path, "file", "Truncating");
    const newSize = Math.floor((0.25 + Math.random() * 0.5) * fileData.size);
    await Deno.truncate(fileData.path, newSize);
    fileData.size = newSize;
  }

  // ! Unstable
  // /** Reset file timestamps to `1970-01-01T00:00:00.000Z`. */
  static async resetTimestamps(fileData: FileData) {
    logger.debug(fileData.path, "file", "ResetTimestamps called");
    await Deno.utime(fileData.path, new Date(0), new Date(0));
  }

  // ! Unstable
  // /** Randomize file timestamps to a random value between `date1` and `date2`.
  //  * Setting the same value to `date1` and `date2` will take away the randomness. */
  static async changeTimestamps(
    fileData: FileData,
    { date1 = new Date(0), date2 = new Date() }: {
      date1?: Date;
      date2?: Date;
    } = {},
  ) {
    logger.debug(fileData.path, "file", "ChangeTimestamps called");
    const date = new Date(randomValueBetween(date2.getTime(), date1.getTime()));
    await Deno.utime(fileData.path, date, date);
  }
}

export class DirectoryWriter {
  /** Retrieves information about the directory.
   * This function is mandatory. */
  static async init(path: string): Promise<DirData> {
    logger.start(path, "dir");
    const fileInfo = await Deno.stat(path);
    if (fileInfo.isDirectory === false) {
      throw new Error("The specified path is not a directory.");
    }
    return { path };
  }
}

export class DirectoryProperties {
  /** Renames the directory to a random string (uuid v4). */
  static async rename(dirData: DirData) {
    logger.debug(dirData.path, "dir", "Renaming");
    const newName = uuid.v4.generate();
    const newPath = path.join(path.dirname(dirData.path), newName);
    await Deno.rename(dirData.path, newPath);
    dirData.path = newPath;
  }

  // ! Unstable
  /** Reset file timestamps to `1970-01-01T00:00:00.000Z`. */
  static async resetTimestamps(dirData: DirData) {
    logger.debug(dirData.path, "dir", "ResetTimestamps called");
    await Deno.utime(dirData.path, new Date(0), new Date(0));
  }

  // ! Unstable
  // /** Randomize file timestamps to a random value between `date1` and `date2`.
  //  * Setting the same value to `date1` and `date2` will take away the randomness. */
  static async changeTimestamps(
    dirData: DirData,
    { date1 = new Date(0), date2 = new Date() }: {
      date1?: Date;
      date2?: Date;
    } = {},
  ) {
    logger.debug(dirData.path, "dir", "ChangeTimestamps called");
    const date = new Date(randomValueBetween(date2.getTime(), date1.getTime()));
    await Deno.utime(dirData.path, date, date);
  }
}

function randomValueBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export interface FileData {
  path: string;
  size: number;
  checksum: hash.Sha256;
  verifyChecksum: boolean;
}

export interface DirData {
  path: string;
}
