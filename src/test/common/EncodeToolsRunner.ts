import EncodeTools, {
  BinaryEncoding,
  BinaryInputOutput,
  CompressionFormat,
  EncodeToolsFormat,
  EncodingOptions,
  HashAlgorithm,
  IDFormat,
  ImageFormat,
  InvalidFormat,
  SerializationFormat
} from "../../EncodeTools";
import {Buffer} from "buffer";
import {Chance} from 'chance';
import Base85 from 'base85';
import {assert} from 'chai';
import * as hashWasm from "hash-wasm";
import * as msgpack from '@msgpack/msgpack';
const Jimp = require('jimp');
const cbor = require('cbor-web');

const sharp = require('sharp');

const bson = require('bson');

const ObjSorter = require('node-object-hash/dist/objectSorter');

import IntegerOptions = Chance.IntegerOptions;

const  Hashids = require('hashids/cjs');
const base32 = require('base32.js');

export function randomBuffer(opts: IntegerOptions = { min: 0, max: 50e3 }): Buffer {
  let chance = Chance();
  return require("crypto").randomBytes(chance.integer(opts));
}

export type ProgWrap<F extends EncodeToolsFormat> = (fn: () => Promise<void>, format: F) => Promise<void>;

export function randomObject(): any {
  let chance = Chance();
  return {
    [chance.string()]: chance.string(),
    [chance.string()]: chance.integer(),
    [chance.string()]: chance.bool(),
    [chance.string()]: null,
    [chance.string()]: [ chance.integer() ]
  };
}

export interface GenerateResult<I, O extends BinaryInputOutput> {
  encoded: O,
  decoded: I
}

export function randomOption<T extends EncodeToolsFormat>(pool: any): T {
  let chance = Chance();
  return chance.shuffle(Object.keys(pool).map(k => pool[k]))[0] as T;
}

export function randomOptions(): EncodingOptions {
  let chance = Chance();
  return {
    compressionFormat: randomOption<CompressionFormat>(CompressionFormat),
    serializationFormat: randomOption<SerializationFormat>(SerializationFormat),
    binaryEncoding: randomOption<BinaryEncoding>(BinaryEncoding),
    hashAlgorithm: randomOption<HashAlgorithm>(HashAlgorithm),
    uniqueIdFormat: randomOption<IDFormat>(IDFormat),
    compressionLevel: chance.integer({ min: 1, max: 9 })
  }
}

export interface FunctionNameSet { encodeName: string, decodeName?: string }
export type EncodeToolsFactory<E extends EncodeTools> = () => Promise<E>;

export abstract class EncodeToolsRunner<I, O extends BinaryInputOutput, F extends EncodeToolsFormat, E extends EncodeTools> {
  public formats: Set<F>;
  constructor(formats: F[], protected encodeToolsFactory: EncodeToolsFactory<E> = async () => { return new EncodeTools() as E; }, public timeout: number = 60e3) {
    this.formats = new Set<F>(formats);
  }
  public abstract get functionName(): FunctionNameSet;
  public abstract encode(input: I, format: F): Promise<O>;
  public abstract decode?(input: O, format: F): Promise<I>;
  public abstract generate(format: F): Promise<GenerateResult<I, O>>;


  public get hasDecode(): boolean { return Boolean(this.decode); }
  public async compareEncoded(out: O, _in: O, format: F, msg: string = `Output from encoding ${format} from ${this.functionName.encodeName} not equal`): Promise<void> {
    assert.deepEqual(out, _in, msg);
  }
  public async compareDecoded(out: I, _in: I, format: F, msg: string = `Output from decoding ${format} to ${this.functionName.decodeName} not equal`): Promise<void> {
    assert.deepEqual(out, _in, msg);
  }

  public async createEncodeTools(): Promise<E> {
    return this.encodeToolsFactory();
  }

  public async testEncode(): Promise<void> {
    let self = this;
    describe('EncodeTools/'+this.functionName.encodeName, async function () {
      this.timeout(self.timeout);
      for (let format of self.formats) {
          it(`should use ${self.functionName.encodeName} encode to ${format}`, async function () {
            let {decoded: inDecoded, encoded: inEncoded} = await self.generate(format)
            let outEncoded = await self.encode(inDecoded, format);
             await self.compareEncoded(outEncoded, inEncoded, format);
        });
      }
    });
  }

  public async testDecode?(): Promise<void> {
    let self = this;
    describe('EncodeTools/'+this.functionName.decodeName, async function () {
      this.timeout(self.timeout);
      for (let format of self.formats) {
        it(`should use ${self.functionName.decodeName} decode from ${format}`, async function () {
          let {decoded: inDecoded, encoded: inEncoded} = await self.generate(format);
          let outDecoded = await self.decode(inEncoded, format);
          await self.compareDecoded(outDecoded, inDecoded, format);
        });
      }
    });
  }
}

export class EncodeBufferRunner extends EncodeToolsRunner<Buffer, BinaryInputOutput, BinaryEncoding, EncodeTools> {
    constructor(formats: BinaryEncoding[] = Object.keys(BinaryEncoding).map(enc => (BinaryEncoding as any)[enc])) {
      super(formats);
    }
    public async encode(input: Buffer, format: BinaryEncoding): Promise<BinaryInputOutput> {
       const enc = await this.createEncodeTools();
       return enc.encodeBuffer(input, format);
    }
    public async decode(input: BinaryInputOutput, format: BinaryEncoding): Promise<Buffer> {
      const enc = await this.createEncodeTools();
      return enc.decodeBuffer(input, format);
    }

    get functionName(): FunctionNameSet { return { decodeName: 'decodeBuffer', encodeName: 'encodeBuffer'  }; }

    public async generate(format: BinaryEncoding): Promise<GenerateResult<Buffer, BinaryInputOutput>> {
      let decoded = randomBuffer();
      let encoded: BinaryInputOutput;
      switch (format) {
        case BinaryEncoding.nodeBuffer:
          encoded = decoded;
          break;
        case BinaryEncoding.arrayBuffer:
          encoded = decoded.buffer;
          break;
        case BinaryEncoding.base64:
          encoded = decoded.toString('base64');
          break;
        // case BinaryEncoding.z85:
        //   encoded = Base85.encode(decoded, 'z85');
        //   break;
        case BinaryEncoding.ascii85:
          encoded = Base85.encode(decoded, 'ascii85');
          break;
        case BinaryEncoding.hex:
          encoded = decoded.toString('hex');
          break;
        case BinaryEncoding.base32:
          const encoder = new base32.Encoder();
          const base32String = encoder.write(EncodeTools.ensureBuffer(decoded)).finalize();
          encoded = base32String;
          break;
        case BinaryEncoding.base64url:
          let base64url = decoded.toString('base64');
          base64url = base64url.replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');

          encoded = base64url;
          break;
        case BinaryEncoding.hashids:
          const hasher = new Hashids();
          const hex = decoded.toString('hex');
          encoded = hasher.encodeHex(hex);
        break;
      }
      return {
        encoded,
        decoded
      };
  };
}

export abstract class HashRunnerBase<I> extends EncodeToolsRunner<I, BinaryInputOutput, HashAlgorithm, EncodeTools> {
  constructor(formats: HashAlgorithm[] = Object.keys(HashAlgorithm).map(enc => (HashAlgorithm as any)[enc]), factory?: EncodeToolsFactory<EncodeTools>) {
    super(formats, factory);

    this.formats.delete(HashAlgorithm.xxhash3);
    this.formats.delete(HashAlgorithm.bcrypt);
    this.formats.delete(HashAlgorithm.sha2);
  }

  public abstract decode(input: BinaryInputOutput, format: HashAlgorithm): Promise<I>;
  public abstract encode(input: any, format: HashAlgorithm): Promise<BinaryInputOutput>;

  abstract get functionName(): FunctionNameSet;

  public abstract generate(format: HashAlgorithm): Promise<GenerateResult<I, BinaryInputOutput>>;

  protected async generateBuffer(decoded: I,  format: HashAlgorithm): Promise<Buffer> {
    let encoded: BinaryInputOutput;
    switch (format) {
      case HashAlgorithm.sha512:
      case HashAlgorithm.sha2:
      case HashAlgorithm.md5:
      case HashAlgorithm.sha1:
      case HashAlgorithm.crc32:
      case HashAlgorithm.xxhash32:
      case HashAlgorithm.xxhash64:
      case HashAlgorithm.sha3:
        encoded = await (hashWasm as any)[format](decoded) as BinaryInputOutput;
        break;
      default:
        throw new InvalidFormat(format);
    }
    // @ts-ignore
    return Buffer.from(encoded, 'hex');
  }
}
export class HashObjectRunner extends HashRunnerBase<any> {
  get functionName(): FunctionNameSet {
    return { encodeName: 'hashObject' };
  }
  public async encode(input: any, format: HashAlgorithm): Promise<BinaryInputOutput> {
    const enc = await this.createEncodeTools();
    return (await enc.hashObject(input, format) as Buffer);
  }
  public async generate(format: HashAlgorithm): Promise<GenerateResult<any, BinaryInputOutput>> {
    let obj = randomObject();
    let sorter = ObjSorter();
    let decoded = Buffer.from(sorter(obj), 'utf8');
    let encoded = await this.generateBuffer(decoded, format);

    return { decoded: obj, encoded };
  }

  public decode: undefined = void(0);
}

export class HashStringRunner extends HashRunnerBase<BinaryInputOutput> {
  get functionName(): FunctionNameSet {
    return { encodeName: 'hashString' };
  }
  public async encode(input: BinaryInputOutput, format: HashAlgorithm): Promise<string> {
    const enc = await this.createEncodeTools();
    return (await enc.hashString(input, format));
  }
  public async generate(format: HashAlgorithm): Promise<GenerateResult<BinaryInputOutput, BinaryInputOutput>> {
    let decoded = randomBuffer();
    let encoded = (await this.generateBuffer(decoded, format)).toString('hex');

    return { decoded, encoded };
  }

  public decode: undefined = void(0);
}
export class HashRunner extends HashRunnerBase<BinaryInputOutput> {
  get functionName(): FunctionNameSet {
    return { encodeName: 'hash' };
  }
  public async encode(input: BinaryInputOutput, format: HashAlgorithm): Promise<BinaryInputOutput> {
    const enc = await this.createEncodeTools();
    return (await enc.hash(input, format) as Buffer);
  }
  public async generate(format: HashAlgorithm): Promise<GenerateResult<BinaryInputOutput, BinaryInputOutput>> {
    let decoded = await randomBuffer();
    let encoded = await this.generateBuffer(decoded, format);

    return { decoded, encoded };
  }

  public decode: undefined = void(0);
}

export class SerializeObjectRunner extends EncodeToolsRunner<any, BinaryInputOutput, SerializationFormat, EncodeTools> {
  constructor(formats: SerializationFormat[] = Object.keys(SerializationFormat).map(enc => (SerializationFormat as any)[enc])) {
    super(formats);
  }
  public async encode(input: any, format: SerializationFormat): Promise<BinaryInputOutput> {
    const enc = await this.createEncodeTools();
    return enc.serializeObject<any>(input, format);
  }
  public async decode(input: BinaryInputOutput, format: SerializationFormat): Promise<any> {
    const enc = await this.createEncodeTools();
    return enc.deserializeObject<any>(Buffer.from(input as any), format);
  }

  get functionName(): FunctionNameSet { return { decodeName: 'deserializeObject', encodeName: 'serializeObject'  }; }

  public async generate(format: SerializationFormat): Promise<GenerateResult<any, BinaryInputOutput>> {
    let decoded = randomObject();
    let encoded: BinaryInputOutput;
    switch (format) {
      case SerializationFormat.json:
        encoded = JSON.stringify(decoded);
        break;
      case SerializationFormat.msgpack:
        encoded = msgpack.encode(decoded);
        break;
      case SerializationFormat.cbor:
        encoded = cbor.encode(decoded);
        break;
      case SerializationFormat.bson:
        encoded = bson.serialize(decoded);
        break;
      default:
        throw new InvalidFormat();
    }
    return {
      encoded,
      decoded
    };
  };
}

export class EncodeObjectRunner extends EncodeToolsRunner<any, BinaryInputOutput, BinaryEncoding, EncodeTools> {
  constructor(formats: BinaryEncoding[] = Object.keys(BinaryEncoding).map(enc => (BinaryEncoding as any)[enc])) {
    super(formats);
  }
  public async encode(input: any, format: BinaryEncoding): Promise<BinaryInputOutput> {
    const enc = await this.createEncodeTools();
    enc.options.serializationFormat = SerializationFormat.json;
    return enc.encodeObject<any>(input, format);
  }
  public async decode(input: BinaryInputOutput, format: BinaryEncoding): Promise<any> {
    const enc = await this.createEncodeTools();
    enc.options.serializationFormat = SerializationFormat.json;
    return enc.decodeObject<any>(Buffer.from(input as any), format);
  }

  get functionName(): FunctionNameSet { return { decodeName: 'decodeObject', encodeName: 'encodeObject'  }; }

  public async generate(format: BinaryEncoding): Promise<GenerateResult<any, BinaryInputOutput>> {
    let decodedObj = randomObject();
    let decoded = Buffer.from(JSON.stringify(decodedObj));
    let encoded: BinaryInputOutput;
    switch (format) {
      case BinaryEncoding.nodeBuffer:
        encoded = decoded;
        break;
      case BinaryEncoding.arrayBuffer:
        encoded = decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset+decoded.byteLength);
        break;
      case BinaryEncoding.base64:
        encoded = decoded.toString('base64');
        break;
      case BinaryEncoding.hex:
        encoded = decoded.toString('hex');
        break;
      // case BinaryEncoding.z85:
      //   encoded = Base85.encode(decoded, 'z85');
      //   break;
      case BinaryEncoding.ascii85:
        encoded = Base85.encode(decoded, 'ascii85');
        break;
      case BinaryEncoding.base32:
        const encoder = new base32.Encoder();
        const base32String = encoder.write(EncodeTools.ensureBuffer(decoded)).finalize();
        encoded = base32String;
        break;
      case BinaryEncoding.base64url:
        let base64url = decoded.toString('base64');
        base64url = base64url.replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');

        encoded = base64url;
        break;
      case BinaryEncoding.hashids:
        const hasher = new Hashids();
        const hex = decoded.toString('hex');
        encoded = hasher.encodeHex(hex);
        break;
    }
    return {
      encoded,
      decoded: decodedObj
    };
  };
}

export class CompressRunner extends EncodeToolsRunner<BinaryInputOutput, BinaryInputOutput, CompressionFormat, EncodeTools> {
  constructor(formats: CompressionFormat[] = Object.keys(CompressionFormat).map(enc => (CompressionFormat as any)[enc])) {
    super(formats);
  }

  protected compressionLevel = (new Chance()).integer({ min: 1, max: 9 })

  public async encode(input: BinaryEncoding, format: CompressionFormat): Promise<BinaryInputOutput> {
    const enc = await this.createEncodeTools();
    return enc.compress(input, format, this.compressionLevel);
  }
  public async decode(input: BinaryInputOutput, format: CompressionFormat): Promise<any> {
    const enc = await this.createEncodeTools();
    return enc.decompress(input, format);
  }

  get functionName(): FunctionNameSet { return { decodeName: 'decompress', encodeName: 'compress'  }; }

  public async generate(format: CompressionFormat): Promise<GenerateResult<BinaryInputOutput, BinaryInputOutput>> {
    let chance =  new Chance();
    let decoded = randomBuffer();
    let encoded: BinaryInputOutput;
    switch (format) {
      case CompressionFormat.lzma:
        encoded = Buffer.from(await new Promise<Buffer>((resolve, reject) => {
          (new (require('lzma').LZMA)()).compress(decoded, this.compressionLevel, (result: any, error: any) => {
            if (error) reject(error);
            else resolve(result);
          });
        }));
        break;
      case CompressionFormat.zstd:
        encoded =  Buffer.from(await new Promise<Buffer>((resolve, reject) => {
          require('zstd-codec').ZstdCodec.run((zstd: any) => {
            const simple = new zstd.Simple();
            try {
              const data = simple.compress(decoded, chance.integer({ min: 1, max: 9 }));
              resolve(data);
            } catch (err) {
              reject(err);
            }
          });
        }));
        break
      default:
        throw new InvalidFormat();
    }
    return {
      encoded,
      decoded
    };
  };
}

export function randomDims(max: number) {
  let chance =  new Chance();
  return chance.bool() ? (
    {
      height: chance.integer({ min: 1, max })
    }
  ) : (
    chance.bool() ? {
      width: chance.integer({ min: 1, max })
    } :  {
      height: chance.integer({ min: 1, max }),
      width: chance.integer({ min: 1, max })
    }
  );
}

export abstract class ImageRunnerBase extends EncodeToolsRunner<BinaryInputOutput, BinaryInputOutput, ImageFormat, EncodeTools> {
  constructor(formats: ImageFormat[] = Object.keys(ImageFormat).map(enc => (ImageFormat as any)[enc])) {
    super(formats);

    this.formats.delete(ImageFormat.avif);
    this.formats.delete(ImageFormat.gif);
    this.formats.delete(ImageFormat.tiff);
    this.formats.delete(ImageFormat.webp);
    // this.formats.delete(ImageFormat.svg);
  }

  /**
   * Taken from https://zb.gy/4CP5
   */
  public static getRandomColor() {
    let s = Math.floor(Math.random()*16777215).toString(16);
    return s + `000000`.substr(s.length);
  }

  public abstract encode(input: BinaryEncoding, format: ImageFormat): Promise<BinaryInputOutput>;
  public decode?: (input: BinaryInputOutput, format: ImageFormat) => Promise<BinaryInputOutput> = void(0);
  public abstract get functionName(): FunctionNameSet;
  public abstract generate(format: ImageFormat): Promise<GenerateResult<BinaryInputOutput, BinaryInputOutput>>;
  public async generateBuffer(format: ImageFormat = ImageFormat.png, opts: IntegerOptions = { min: 500, max: 1e3 }): Promise<Buffer> {
    let chance =  new Chance();

    let wh = chance.integer(opts);
    let decodedRaw = await new Promise<any>((resolve, reject) => {
      new (Jimp)(wh, wh, ImageRunnerBase.getRandomColor(), (err: unknown, image: any) => {
        if (err) reject(err);
        else resolve(image);
      });
    });

    let decoded = await decodedRaw.getBufferAsync(`image/${format}`);

    return decoded;
  };
}

export class ImageResizeRunner extends ImageRunnerBase {
  constructor(protected width: number = (() => { let c = Chance(); return c.integer({ min: 1, max: 1e3 }) })()) {
    super();
  }
  public async encode(input: BinaryEncoding, format: ImageFormat): Promise<BinaryInputOutput> {
    let enc = await this.encodeToolsFactory();

    return enc.resizeImage(input, { width: this.width, height: this.width }, format);
  }
  public decode?: (input: BinaryInputOutput, format: ImageFormat) => Promise<BinaryInputOutput> = void(0);
  public get functionName(): FunctionNameSet {
    return { encodeName: 'resizeImage' };
  }
  public async generate(format: ImageFormat): Promise<GenerateResult<BinaryInputOutput, BinaryInputOutput>> {
     let decoded = await this.generateBuffer(format);
     let encodedRaw = await Jimp.read(decoded);

     encodedRaw.resize(this.width, this.width);

     let encoded = await encodedRaw.getBufferAsync(`image/${format}`);

     return {
       decoded,
       encoded
     }
  }
}

export class ImageCropRunner extends ImageRunnerBase {
  constructor(protected width: number = (() => { let c = Chance(); return c.integer({ min: 500, max: 1e3 }) })(), protected x: number = 0) {
    super();
  }
  public async encode(input: BinaryEncoding, format: ImageFormat): Promise<BinaryInputOutput> {
    let enc = await this.encodeToolsFactory();

    return enc.cropImage(input, { width: this.width, height: this.width, left: this.x, top: this.x }, format);
  }
  public decode?: (input: BinaryInputOutput, format: ImageFormat) => Promise<BinaryInputOutput> = void(0);
  public get functionName(): FunctionNameSet {
    return { encodeName: 'cropImage' };
  }
  public async generate(format: ImageFormat): Promise<GenerateResult<BinaryInputOutput, BinaryInputOutput>> {
    let decoded = await this.generateBuffer(format, { min: this.width+1, max: (this.width+1)*2 });
    let encodedRaw = await Jimp.read(decoded);

    encodedRaw.crop(this.x, this.x, this.width, this.width);

    let encoded = await encodedRaw.getBufferAsync(`image/${format}`);

    return {
      decoded,
      encoded
    }
  }
}

export class ImageConvertRunner extends ImageRunnerBase {
  constructor() {
    super();
  }
  public async encode(input: BinaryEncoding, format: ImageFormat): Promise<BinaryInputOutput> {
    let enc = await this.encodeToolsFactory();

    return enc.convertImage(input, format);
  }
  public decode?: (input: BinaryInputOutput, format: ImageFormat) => Promise<BinaryInputOutput> = void(0);
  public get functionName(): FunctionNameSet {
    return { encodeName: 'convertImage' };
  }
  public async generate(format: ImageFormat): Promise<GenerateResult<BinaryInputOutput, BinaryInputOutput>> {
    let decoded = await this.generateBuffer(format);
    let encodedRaw = await Jimp.read(decoded);

    let encoded = await encodedRaw.getBufferAsync(`image/${format}`);

    return {
      decoded,
      encoded
    }
  }
}

export class ImageBrightnessRunner extends ImageRunnerBase {
  constructor(protected brightnessFactor: number = (() => { let c = Chance(); return c.floating({ min: -1, max: 1 }) })()) {
    super();
  }
  public async encode(input: BinaryEncoding, format: ImageFormat): Promise<BinaryInputOutput> {
    let enc = await this.encodeToolsFactory();

    return enc.adjustImageBrightness(input, this.brightnessFactor, format);
  }
  public decode?: (input: BinaryInputOutput, format: ImageFormat) => Promise<BinaryInputOutput> = void(0);
  public get functionName(): FunctionNameSet {
    return { encodeName: 'adjustImageBrightness' };
  }
  public async generate(format: ImageFormat): Promise<GenerateResult<BinaryInputOutput, BinaryInputOutput>> {
    let decoded = await this.generateBuffer(format);
    let encodedRaw = await Jimp.read(decoded);

    encodedRaw.brightness(this.brightnessFactor);

    let encoded = await encodedRaw.getBufferAsync(`image/${format}`);

    return {
      decoded,
      encoded
    }
  }
}
