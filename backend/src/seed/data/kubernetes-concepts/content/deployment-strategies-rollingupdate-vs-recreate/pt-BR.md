---
version: 1.0
updatedAt: 2026-09-26
title: "Estratégias de Deploy: RollingUpdate vs Recreate"
summary: "maxSurge e maxUnavailable com suas regras de arredondamento, como um rollout quebrado aparece, e quando Recreate é a escolha certa."
---
## Objective

Quando o template de Pod de um Deployment muda, o Kubernetes troca os Pods antigos por novos de acordo com `spec.strategy`. O `RollingUpdate`, padrão, troca aos poucos e mantém o serviço disponível; o `Recreate` para tudo primeiro e depois sobe a versão nova. O comportamento do rolling é controlado por dois números, `maxSurge` e `maxUnavailable`, cujo arredondamento de porcentagem surpreende quem tem poucas réplicas. Este conceito cobre as duas estratégias, a aritmética, como um rollout com falha aparece, e qual estratégia combina com qual workload.

## Use Cases

- Deploys sem downtime de uma API web stateless com duas ou mais réplicas.
- Implantar um banco de dados ou message broker de uma réplica que nunca pode rodar duas vezes sobre o mesmo volume.
- Atualizar num nó com pouca memória livre, onde um Pod de surge não cabe.
- Entender por que uma imagem quebrada não derrubou o serviço.

## Deep Dive

### RollingUpdate

```yaml
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%          # padrão: quantos Pods acima de `replicas` podem existir
      maxUnavailable: 25%    # padrão: quantos abaixo de `replicas` podem ficar indisponíveis
  minReadySeconds: 10        # um Pod novo precisa ficar Ready por esse tempo para contar como disponível
```

O controller aumenta o ReplicaSet novo e reduz o antigo em passos, nunca passando de `replicas + maxSurge` Pods e nunca caindo abaixo de `replicas - maxUnavailable` Pods **disponíveis**. "Disponível" significa Ready (readiness probe passando) por pelo menos `minReadySeconds`. Sem readiness probe, um Pod fica Ready assim que o container sobe, então o rollout segue em frente mesmo que a aplicação lá dentro ainda esteja iniciando ou quebrada.

### A regra de arredondamento

As porcentagens viram números absolutos: `maxSurge` arredonda **para cima**, `maxUnavailable` arredonda **para baixo**.

| replicas | maxSurge 25% | maxUnavailable 25% | Comportamento |
|---|---|---|---|
| 1 | 1 | 0 | sobe 1 novo, espera ficar disponível, para o antigo |
| 2 | 1 | 0 | sempre 2 disponíveis; um Pod extra durante a atualização |
| 4 | 1 | 1 | até 5 Pods, pelo menos 3 disponíveis |
| 10 | 3 | 2 | até 13 Pods, pelo menos 8 disponíveis |

Verificado no k3s com 2 réplicas e uma tag de imagem inexistente:

```
NAME                   READY   STATUS             RESTARTS   AGE
web-595b4ff974-jkhnn   0/1     ImagePullBackOff   0          20s
web-6b48bf5ccc-4cvpp   1/1     Running            0          20s
web-6b48bf5ccc-rppzw   1/1     Running            0          21s
```

Um Pod de surge foi criado e nunca ficou pronto; como `maxUnavailable` é 0, nenhum Pod antigo foi tocado. O serviço continuou totalmente de pé e o rollout simplesmente travou. Essa é a rede de segurança que o rolling update dá, **desde que os Pods novos consigam falhar na readiness**.

### Quando o rollout trava

Um rollout travado não volta sozinho. Depois de `progressDeadlineSeconds` (padrão 600) o Deployment ganha a condition `Progressing=False, reason=ProgressDeadlineExceeded`, e o `kubectl rollout status` sai com erro. Os Pods antigos continuam atendendo. Você corrige para frente (imagem nova) ou volta com `kubectl rollout undo`; veja o conceito de rollouts.

### Recreate

```yaml
spec:
  replicas: 1
  strategy:
    type: Recreate
```

Todos os Pods antigos são encerrados, e só quando eles somem os novos são criados. Há downtime entre os dois, do tamanho do shutdown do Pod antigo mais a inicialização do novo.

Por que aceitar isso? Porque alguns workloads nunca podem rodar duas instâncias ao mesmo tempo:

- **Um banco de dados ou broker num volume `ReadWriteOnce`.** Com RollingUpdate, o Pod novo sobe enquanto o antigo ainda segura o volume. Num nó único os dois conseguem montar de fato um volume hostPath ou local (RWO é por nó, não por Pod), e dois processos de banco no mesmo diretório de dados é corrupção. Muitos bancos mantêm um arquivo de lock que normalmente barra o segundo, mas confiar nisso não é estratégia.
- **Singletons**: um agendador que não pode disparar duas vezes, um consumidor que assume estar sozinho.
- **Um nó sem espaço para um Pod de surge.** Com RollingUpdate, o Pod novo precisa do seu request de memória inteiro enquanto o antigo ainda segura o dele. Se o nó não comporta os dois, o Pod novo fica `Pending` para sempre. `Recreate`, ou `maxSurge: 0, maxUnavailable: 1`, libera o espaço primeiro.

### Um meio-termo para uma réplica

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate: {maxSurge: 0, maxUnavailable: 1}
```

Com uma réplica isso se comporta como Recreate (para, depois sobe), mas vale por Pod, então com mais réplicas vira "troque um de cada vez sem capacidade extra".

### Graceful shutdown importa nos dois casos

Pods antigos recebem `SIGTERM`, ganham `terminationGracePeriodSeconds` (padrão 30) para terminar, e depois `SIGKILL`. Enquanto isso eles são removidos dos endpoints do Service, mas essa remoção se propaga de forma assíncrona, então algumas requisições ainda podem chegar depois do `SIGTERM`. Uma aplicação que termina as requisições em andamento ao receber `SIGTERM` (a maioria dos servidores web e frameworks suporta graceful shutdown) mais um `preStop` curto de espera fecha essa janela:

```yaml
lifecycle:
  preStop:
    sleep: {seconds: 5}        # ação nativa de sleep, não precisa de shell na imagem
```

## Trade-offs

- **RollingUpdate** dá zero downtime e uma rede de segurança embutida, e exige readiness probes, capacidade sobrando para Pods de surge, e uma aplicação que tolere duas versões rodando lado a lado (schema do banco compatível com as duas).
- **Recreate** é simples e seguro para singletons stateful, e sempre custa uma queda curta. Para um banco de uma réplica não existe opção de rolling que evite isso de qualquer forma.
- **Valores agressivos vs conservadores.** `maxSurge`/`maxUnavailable` altos terminam rollouts mais rápido; `maxUnavailable: 0` garante capacidade mas precisa de espaço para surge.

## Documentation Links

- [Kubernetes docs: Deployments (strategy)](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy): Recreate, RollingUpdate, maxSurge e maxUnavailable.
- [Kubernetes docs: Failed Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#failed-deployment): `progressDeadlineSeconds` e conditions.
- [Kubernetes docs: Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination): SIGTERM, grace period, preStop.
- [Kubernetes docs: Container Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/): `preStop` e sua interação com o grace period.
