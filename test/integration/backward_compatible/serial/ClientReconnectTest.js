/*
 * Copyright (c) 2008-2022, Hazelcast, Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const { expect } = require('chai');
const RC = require('../../RC');
const TestUtil = require('../../../TestUtil');
const sinon = require('sinon');
const sandbox = sinon.createSandbox();
const { ConnectionManager } = require('../../../../lib/network/ConnectionManager');

/**
 * Basic tests for reconnection to cluster scenarios.
 */
describe('ClientReconnectTest', function () {
    let cluster;
    let client;

    const testFactory = new TestUtil.TestFactory();

    beforeEach(function () {
       client = undefined;
       cluster = undefined;
    });

    afterEach(async function () {
        await testFactory.shutdownAll();
    });

    it('should send the client state to the cluster after reconnections, ' +
        +'regardless it is connected back to possibly the same cluster with the same id or not.', async function () {
        const fakeInitializeClientOnCluster = sandbox.replace(
            ConnectionManager.prototype,
            'initializeClientOnCluster',
            sandbox.fake(ConnectionManager.prototype.initializeClientOnCluster)
        );
        cluster = await testFactory.createClusterForSerialTests();
        const member = await RC.startMember(cluster.id);
        client = await testFactory.newHazelcastClientForSerialTests({
            clusterName: cluster.id,
            properties: {
                'hazelcast.client.heartbeat.interval': 1000,
                'hazelcast.client.heartbeat.timeout': 3000
            }
        });
        await RC.terminateMember(cluster.id, member.uuid);
        await TestUtil.waitForConnectionCount(client, 0);
        await RC.startMember(cluster.id);
        await TestUtil.waitForConnectionCount(client, 1);
        fakeInitializeClientOnCluster.callCount.should.be.eq(1);
    });

    /**
     * getMap(), map.put() messages are not retryable. If terminateMember does not
     * close the client connection immediately it is possible for the client to realize that later when map.put
     * or getMap invocation started. In that case, the connection will be closed with TargetDisconnectedError.
     * Because these client messages are not retryable, the invocation will be rejected with an error, leading
     * to flaky tests. To avoid that, we use the "TestUtil.waitForConnectionCount" function
     * to wait for disconnection in the tests below.
     */
    it('member restarts, while map.put in progress', async function () {
        cluster = await testFactory.createClusterForSerialTests();
        const member = await RC.startMember(cluster.id);
        client = await testFactory.newHazelcastClientForSerialTests({
            clusterName: cluster.id,
            properties: {
                'hazelcast.client.heartbeat.interval': 1000,
                'hazelcast.client.heartbeat.timeout': 3000
            }
        });
        const map = await client.getMap('test');

        await RC.terminateMember(cluster.id, member.uuid);
        await TestUtil.waitForConnectionCount(client, 0);
        await RC.startMember(cluster.id);

        await map.put('testkey', 'testvalue');
        const val = await map.get('testkey');
        expect(val).to.equal('testvalue');
    });

    it('member restarts, while map.put in progress 2', async function () {
        cluster = await testFactory.createClusterForSerialTests();
        const member = await RC.startMember(cluster.id);
        client = await testFactory.newHazelcastClientForSerialTests({
            clusterName: cluster.id,
            network: {
                connectionTimeout: 10000
            },
            properties: {
                'hazelcast.client.heartbeat.interval': 1000,
                'hazelcast.client.heartbeat.timeout': 3000
            }
        });
        const map = await client.getMap('test');
        await RC.terminateMember(cluster.id, member.uuid);
        await TestUtil.waitForConnectionCount(client, 0);

        const promise = map.put('testkey', 'testvalue').then(() => {
            return map.get('testkey');
        }).then((val) => {
            expect(val).to.equal('testvalue');
        });

        await RC.startMember(cluster.id);

        await promise;
    });

    it('create proxy while member is down, member comes back', async function () {
        cluster = await testFactory.createClusterForSerialTests();
        const member = await RC.startMember(cluster.id);
        client = await testFactory.newHazelcastClientForSerialTests({
            clusterName: cluster.id,
            properties: {
                'hazelcast.client.heartbeat.interval': 1000,
                'hazelcast.client.heartbeat.timeout': 3000
            }
        });
        await RC.terminateMember(cluster.id, member.uuid);
        await TestUtil.waitForConnectionCount(client, 0);

        let map;

        const promise = client.getMap('test').then(mp => {
            map = mp;
            return map.put('testkey', 'testvalue');
        }).then(() => {
            return map.get('testkey');
        }).then((val) => {
            expect(val).to.equal('testvalue');
        });

        await RC.startMember(cluster.id);

        await promise;
    });
});
