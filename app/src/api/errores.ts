/** Error con código HTTP: el middleware de errores lo serializa como { error, detalle? }. */
export class ErrorHttp extends Error {
  constructor(
    public status: number,
    message: string,
    public detalle?: unknown,
  ) {
    super(message);
  }
}
