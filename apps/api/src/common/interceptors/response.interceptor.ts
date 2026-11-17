import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Paginated } from '../pagination/paginated';

/** Wraps every successful response as `{ data, meta? }` so the client sees one consistent shape. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        if (body instanceof Paginated) return { data: body.items, meta: body.meta };
        return { data: body === undefined ? null : body };
      }),
    );
  }
}
