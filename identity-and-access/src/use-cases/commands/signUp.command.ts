import { PinoLoggerService } from '@common/logger/adapters/pinoLogger.service';
import { executeTask } from '@common/utils/executeTask';
import { fromUnknown } from '@common/utils/fromUnknown';
import { perform } from '@common/utils/perform';
import { InMemoryUserRepository } from '@identity-and-access/adapters/secondaries/in-memory/inMemoryUser.repository';
import { DefaultAuthenticationService } from '@identity-and-access/adapters/secondaries/real/defaultAuthentication.service';
import { DefaultUUIDGeneratorService } from '@identity-and-access/adapters/secondaries/real/defaultUUIDGenerator.service';
import { User } from '@identity-and-access/domain/entities/user';
import { UnverifiedEmail } from '@identity-and-access/domain/value-objects/emailInfos';
import { PlainPassword } from '@identity-and-access/domain/value-objects/password';
import { UUID } from '@identity-and-access/domain/value-objects/uuid';
import { CommandHandler, ICommand, ICommandHandler } from '@nestjs/cqrs';
import { sequenceS } from 'fp-ts/lib/Apply';
import { pipe } from 'fp-ts/lib/function';
import { chain, map, taskEither } from 'fp-ts/lib/TaskEither';

export class SignUp implements ICommand {
  constructor(public readonly email: string, public readonly password: string) {}
}

@CommandHandler(SignUp)
export class SignUpHandler implements ICommandHandler {
  constructor(
    private readonly uuidGeneratorService: DefaultUUIDGeneratorService,
    private readonly authenticationService: DefaultAuthenticationService,
    private readonly userRepository: InMemoryUserRepository,
    private readonly logger: PinoLoggerService,
  ) {
    this.logger.setContext('SignUp');
  }

  execute(command: SignUp): Promise<void> {
    const { email, password } = command;

    const task = pipe(
      //Data validation
      sequenceS(taskEither)({
        id: fromUnknown(this.uuidGeneratorService.generateUUID(), UUID, this.logger, 'uuid'),
        email: fromUnknown(email, UnverifiedEmail, this.logger, 'email'),
        plainPassword: fromUnknown(password, PlainPassword, this.logger, 'plain password'),
      }),
      chain((validatedDatas) =>
        pipe(
          perform(validatedDatas.email, this.authenticationService.assertEmailUnicity, this.logger, 'assert email unicity'),
          chain(() => perform(validatedDatas.plainPassword, this.authenticationService.hashPlainPassword, this.logger, 'hash plain password')),
          chain((hashedPassword) =>
            fromUnknown(
              {
                id: validatedDatas.id,
                email: validatedDatas.email,
                password: hashedPassword,
              },
              User,
              this.logger,
              'user',
            ),
          ),
        ),
      ),
      //Storage
      chain((user) => perform(user, this.userRepository.save, this.logger, 'save user in storage system.')),
      map(noop),
    );
    return executeTask(task);
  }
}

const noop = () => {};
