import { ClearKeyPair, EncryptedKeyPairV2, Key, SCP, Transaction, Utils } from '@secretarium/connector';

interface SecretariumGatewayConfig {
    key: string;
    gateways: Array<{
        endpoint: string;
        name: string;
    }>;
}

interface SecretariumClusterConfig {
    [cluster: string]: SecretariumGatewayConfig;
}

interface ConnectionInformation {
    cluster: string;
    endpoint: string;
    gateway: string;
    socket: SCP;
}

const handlerStore: {
    currentConnection: SCP;
    currentKey?: Key;
    clusters?: SecretariumClusterConfig;
    fileService?: string;
} = {
    currentConnection: new SCP({
        logger: console
    }),
    currentKey: undefined
};

const gatewaysConfigReducer = (config: SecretariumClusterConfig, current: string): SecretariumClusterConfig => {
    const record = current.split('#');

    if (record.length !== 4)
        return config;

    const [cluster, name, endpoint, key] = record as [string, string, string, string];
    config[cluster] = {
        key,
        gateways: (config[cluster]?.gateways ?? []).concat([
            {
                endpoint,
                name
            }
        ])
    };
    return config;
};

const printClusterInfo = (): void => {

    if (!handlerStore.clusters)
        return;

    const printableConfig: {
        [key: string]: string;
    } = {};

    Object.entries(handlerStore.clusters).forEach(([name, configuration], cindex) => {
        printableConfig[`c${cindex}_name`] = name;
        printableConfig[`c${cindex}_key`] = configuration.key;
        configuration.gateways.forEach((gateway, gindex) => {
            printableConfig[`c${cindex}_g${gindex}_name`] = gateway.name;
            printableConfig[`c${cindex}_g${gindex}_endpoint`] = gateway.endpoint;
        });
    });

    console.info('DK now using the following cluster configuration:');
    console.table(printableConfig);
};

const processClusterConfig: Window['demoKlaveCluster'] = (config) => {
    if (typeof config === 'string')
        handlerStore.clusters = config.split(',').reduce<SecretariumClusterConfig>(gatewaysConfigReducer, {});
    else
        handlerStore.clusters = config as SecretariumClusterConfig;
    printClusterInfo();
};

let currentGateway = -1;

const secretariumHandler = {
    initialize: (): void => {
        let clusterConfigBase = import.meta.env.VITE_APP_SECRETARIUM_GATEWAYS ?? '';

        fetch(`/config.json?v=${import.meta.env.VITE_APP_VERSION ?? '0.0.0'}&t=${Date.now()}`)
            .then(response => response.json())
            .then((config: any) => {
                if (config.SECRETARIUM_GATEWAYS)
                    clusterConfigBase = config.SECRETARIUM_GATEWAYS;
                if (config.DK_SERVICES)
                    handlerStore.fileService = config.DK_SERVICES;
                processClusterConfig(clusterConfigBase);
                console.info('DK now using config.json overrides');
            })
            .catch(() => {
                processClusterConfig(clusterConfigBase);
            });

    },
    createKeyPair: (values: any): Promise<EncryptedKeyPairV2> =>
        new Promise((resolve, reject) => {
            Key.createKey()
                .then((key) => key.seal(values.password))
                .then((key) => {
                    handlerStore.currentKey = key;
                    key.exportEncryptedKey()
                        .then((key) => {
                            resolve({
                                ...key,
                                name: key.name ?? values.email
                            });
                        });
                })
                .catch(e => reject(e));
        }),
    createEphemeral: (): Promise<EncryptedKeyPairV2> =>
        new Promise((resolve, reject) => {
            Key.createKey()
                .then((key) => {
                    handlerStore.currentKey = key;
                    key.exportEncryptedKey().then(resolve);
                })
                .catch(e => reject(e));
        }),
    encryptKey: (keyPair: ClearKeyPair, password: string): Promise<EncryptedKeyPairV2> =>
        Key.importKey(keyPair)
            .then(key => key.seal(password))
            .then(encKey => encKey.exportEncryptedKey()),
    use: (keyPair: EncryptedKeyPairV2, password: string): Promise<ClearKeyPair> => {
        return new Promise((resolve, reject) => {
            Key.importEncryptedKeyPair(keyPair, password)
                .then((key) => {
                    handlerStore.currentKey = key;
                    key.exportKey().then(resolve);
                })
                .catch(e => reject(e));
        });
    },
    connect: (): Promise<ConnectionInformation> =>
        new Promise((resolve, reject) => {

            const clusters = Object.entries<SecretariumGatewayConfig>(handlerStore.clusters ?? {});

            if (!handlerStore.clusters)
                return setTimeout(() => {
                    resolve(secretariumHandler.connect());
                }, 500);

            if (!clusters[0]) {
                console.error('There are no cluster configured !');
                return reject('There are no cluster configured !');
            }

            const cluster = clusters[0];
            let nextGateway = currentGateway;
            do {
                nextGateway = Math.floor(Math.random() * cluster[1].gateways.length);
            } while ((nextGateway === currentGateway && cluster[1].gateways?.length > 1) || nextGateway < 0 || nextGateway >= cluster[1].gateways.length);

            currentGateway = nextGateway;
            const endpoint = cluster[1].gateways?.[nextGateway]?.endpoint;
            if (cluster && endpoint && handlerStore.currentKey) {
                console.info('DK now using the following gateway:', endpoint);
                handlerStore.currentConnection
                    .reset()
                    .connect(endpoint, handlerStore.currentKey, secretariumHandler.utils.fromBase64(cluster[1].key))
                    .then(() => {
                        resolve({
                            cluster: cluster[0],
                            gateway: cluster[1]?.gateways?.[nextGateway]?.name ?? '',
                            endpoint,
                            socket: handlerStore.currentConnection
                        });
                    })
                    .catch((e: Error) => reject(e));
            } else reject('Cluster not configured');
        }),
    isConnected: () => {
        return handlerStore.currentConnection?.state === 1
    },
    disconnect: (hold = false): Promise<void> =>
        new Promise(resolve => {
            handlerStore.currentConnection?.reset();
            handlerStore.currentConnection?.close();

            handlerStore.currentConnection = new SCP();
            if (!hold)
                handlerStore.currentKey = undefined;
            resolve();
        }),
    request: (dcApp: string, command: string, args: Record<string, unknown> | string, id: string): Promise<Transaction> =>
        new Promise((resolve, reject) => {
            if (handlerStore.currentConnection) {
                const queryHandle = handlerStore.currentConnection.newTx(dcApp, command, id, args);
                resolve(queryHandle);
            } else reject('No connection to Secretarium.');
        }),
    utils: Utils
};

if ((import.meta.env.NODE_ENV === 'development' || import.meta.env.VITE_APP_SECRETARIUM_GATEWAYS_OVERWRITABLE === 'true') && window) {
    window['demoKlaveCluster'] = processClusterConfig;
    window['demoKlaveCommand'] = (dcApp, command, args, id): void => {
        secretariumHandler.request(dcApp, command, args ?? {}, id ?? `${Math.random()}`).then(query => {
            query.send();
        });
    };
    window['demoKlaveHandlerStore'] = handlerStore;
}

export default secretariumHandler;
