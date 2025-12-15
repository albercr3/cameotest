declare module 'cors' {
  import { RequestHandler } from 'express';

  interface CorsOptions {
    origin?: boolean | string | RegExp | Array<boolean | string | RegExp>;
    methods?: string | string[];
    allowedHeaders?: string | string[];
    exposedHeaders?: string | string[];
    credentials?: boolean;
    maxAge?: number;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
  }

  interface CorsRequest {
    method?: string;
  }

  function cors(options?: CorsOptions): RequestHandler;
  namespace cors {
    function CorsRequest(options?: CorsOptions): RequestHandler;
  }

  export = cors;
}
