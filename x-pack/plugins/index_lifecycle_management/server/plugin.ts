/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { Observable } from 'rxjs';
import { first } from 'rxjs/operators';
import { i18n } from '@kbn/i18n';
import {
  CoreSetup,
  Plugin,
  Logger,
  PluginInitializerContext,
  LegacyAPICaller,
} from 'src/core/server';

import { Index as IndexWithoutIlm } from '../../index_management/common/types';
import { PLUGIN } from '../common/constants';
import { Index, IndexLifecyclePolicy } from '../common/types';
import { Dependencies } from './types';
import { registerApiRoutes } from './routes';
import { License } from './services';
import { IndexLifecycleManagementConfig } from './config';
import { isEsError } from './shared_imports';

const indexLifecycleDataEnricher = async (
  indicesList: IndexWithoutIlm[],
  callAsCurrentUser: LegacyAPICaller
): Promise<Index[]> => {
  if (!indicesList || !indicesList.length) {
    return [];
  }

  const params = {
    path: '/*/_ilm/explain',
    method: 'GET',
  };

  const { indices: ilmIndicesData } = await callAsCurrentUser<{
    indices: { [indexName: string]: IndexLifecyclePolicy };
  }>('transport.request', params);

  return indicesList.map((index: IndexWithoutIlm) => {
    return {
      ...index,
      ilm: { ...(ilmIndicesData[index.name] || {}) },
    };
  });
};

export class IndexLifecycleManagementServerPlugin implements Plugin<void, void, any, any> {
  private readonly config$: Observable<IndexLifecycleManagementConfig>;
  private readonly license: License;
  private readonly logger: Logger;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
    this.config$ = initializerContext.config.create();
    this.license = new License();
  }

  async setup(
    { http }: CoreSetup,
    { licensing, indexManagement, features }: Dependencies
  ): Promise<void> {
    const router = http.createRouter();
    const config = await this.config$.pipe(first()).toPromise();

    this.license.setup(
      {
        pluginId: PLUGIN.ID,
        minimumLicenseType: PLUGIN.minimumLicenseType,
        defaultErrorMessage: i18n.translate('xpack.indexLifecycleMgmt.licenseCheckErrorMessage', {
          defaultMessage: 'License check failed',
        }),
      },
      {
        licensing,
        logger: this.logger,
      }
    );

    features.registerElasticsearchFeature({
      id: 'index_lifecycle_management',
      management: {
        data: ['index_lifecycle_management'],
      },
      privileges: [
        {
          requiredClusterPrivileges: ['manage_ilm'],
          ui: [],
        },
      ],
    });

    registerApiRoutes({
      router,
      config,
      license: this.license,
      lib: {
        isEsError,
      },
    });

    if (config.ui.enabled) {
      if (indexManagement && indexManagement.indexDataEnricher) {
        indexManagement.indexDataEnricher.add(indexLifecycleDataEnricher);
      }
    }
  }

  start() {}
  stop() {}
}
