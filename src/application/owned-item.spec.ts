import {
  FailureCode,
  ProcessingRequest,
  ProcessingRequestStatus,
} from '../domain/processing-request';
import { toOwnedItem } from './owned-item';

const createdAt = new Date('2026-09-26T10:00:00.000Z');
const updatedAt = new Date('2026-09-26T10:05:00.000Z');

function stored(overrides: Partial<ProcessingRequest>): ProcessingRequest {
  return {
    processingRequestId: '3f1c2a4e-0000-4000-8000-000000000001',
    ownerUserId: 'alice',
    sourceStorageKey: 'sources/alice/video.mp4',
    status: ProcessingRequestStatus.RECEIVED,
    attemptId: undefined,
    zipStorageKey: undefined,
    failureCode: undefined,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

describe('toOwnedItem', () => {
  it('projects exactly the id, status and ISO timestamps', () => {
    expect(toOwnedItem(stored({}))).toStrictEqual({
      processingRequestId: '3f1c2a4e-0000-4000-8000-000000000001',
      status: 'RECEIVED',
      createdAt: '2026-09-26T10:00:00.000Z',
      updatedAt: '2026-09-26T10:05:00.000Z',
    });
  });

  it.each<[FailureCode, string]>([
    ['FORMATO_INVALIDO', 'O arquivo enviado nao e um video MP4 ou MOV valido.'],
    ['DURACAO_EXCEDIDA', 'O video excede a duracao maxima de 10 minutos.'],
    [
      'PROCESSAMENTO_FALHOU',
      'Nao foi possivel processar o video. Tente enviar novamente.',
    ],
  ])(
    'adds the safe sentence for a request FAILED with %s',
    (code, sentence) => {
      const item = toOwnedItem(
        stored({
          status: ProcessingRequestStatus.FAILED,
          attemptId: '9a9a9a9a-0000-4000-8000-000000000002',
          failureCode: code,
        }),
      );

      expect(item).toStrictEqual({
        processingRequestId: '3f1c2a4e-0000-4000-8000-000000000001',
        status: 'FAILED',
        createdAt: '2026-09-26T10:00:00.000Z',
        updatedAt: '2026-09-26T10:05:00.000Z',
        failureReason: sentence,
      });
    },
  );

  it.each([
    ProcessingRequestStatus.QUEUED,
    ProcessingRequestStatus.PROCESSING,
    ProcessingRequestStatus.COMPLETED,
  ])('carries no failureReason when the request is %s', (status) => {
    const item = toOwnedItem(
      stored({
        status,
        attemptId: '9a9a9a9a-0000-4000-8000-000000000002',
        zipStorageKey:
          status === ProcessingRequestStatus.COMPLETED
            ? 'results/alice/frames.zip'
            : undefined,
      }),
    );

    expect(Object.keys(item)).toEqual([
      'processingRequestId',
      'status',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('never carries storage keys, the attempt, the failure code or the owner', () => {
    const item = toOwnedItem(
      stored({
        status: ProcessingRequestStatus.FAILED,
        attemptId: '9a9a9a9a-0000-4000-8000-000000000002',
        zipStorageKey: 'results/alice/frames.zip',
        failureCode: 'PROCESSAMENTO_FALHOU',
      }),
    );
    const serialized = JSON.stringify(item);

    for (const key of [
      'sourceStorageKey',
      'zipStorageKey',
      'attemptId',
      'failureCode',
      'ownerUserId',
    ]) {
      expect(item).not.toHaveProperty(key);
    }
    expect(serialized).not.toContain('sources/alice/video.mp4');
    expect(serialized).not.toContain('results/alice/frames.zip');
    expect(serialized).not.toContain('9a9a9a9a-0000-4000-8000-000000000002');
    expect(serialized).not.toContain('PROCESSAMENTO_FALHOU');
  });
});
