import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevicesService } from './devices.service';
import { EmployeesService } from './employees.service';
import { InvitationsService } from './invitations.service';
import { PasswordService } from './password.service';
import { RolesService } from './roles.service';
import { SessionService } from './session.service';
import {
  DevicesController,
  EmployeesController,
  InvitationsController,
  RolesController,
} from './staff.controller';

@Module({
  imports: [OrganizationModule],
  controllers: [
    AuthController,
    EmployeesController,
    RolesController,
    InvitationsController,
    DevicesController,
  ],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    DevicesService,
    RolesService,
    EmployeesService,
    InvitationsService,
  ],
})
export class IdentityModule {}
