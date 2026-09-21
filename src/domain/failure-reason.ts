import { FailureCode } from './processing-request';

/**
 * The single origin of user-facing failure text.
 *
 * Total over the closed union with no default branch: adding a code without a
 * sentence fails the type check, rather than silently publishing a generic
 * message for a code someone forgot to map.
 *
 * The stored failureCode is the fact; this sentence is presentation, derived
 * at publication and never persisted, so rewording is not a migration.
 */
export function failureReasonFor(code: FailureCode): string {
  switch (code) {
    case 'FORMATO_INVALIDO':
      return 'O arquivo enviado nao e um video MP4 ou MOV valido.';
    case 'DURACAO_EXCEDIDA':
      return 'O video excede a duracao maxima de 10 minutos.';
    case 'PROCESSAMENTO_FALHOU':
      return 'Nao foi possivel processar o video. Tente enviar novamente.';
  }
}
