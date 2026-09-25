---
version: 1.0
updatedAt: 2026-09-25
title: "Secrets como Variáveis de Ambiente vs Arquivos Montados"
summary: "Por que uma Secret rotacionada chega aos arquivos montados em cerca de um minuto mas nunca chega às variáveis de ambiente nem às montagens com subPath, e por que arquivos vazam menos do que env vars."
---
## Objective

Um Pod pode consumir uma Secret de dois jeitos: como variáveis de ambiente (`env` com `secretKeyRef`, ou `envFrom`) ou como arquivos em um volume montado. No primeiro dia os dois parecem equivalentes. Eles se comportam diferente no dia em que você rotaciona uma credencial, e no dia em que algo despeja o ambiente de um processo em um log. Este conceito cobre o que cada mecanismo faz em runtime, por que uma Secret rotacionada chega aos arquivos montados mas nunca às variáveis de ambiente nem às montagens com `subPath`, e o que isso significa para como as aplicações devem ler segredos.

## Use Cases

- Rotacionar a senha de um banco ou uma API key sem reiniciar todos os Pods que a usam.
- Decidir como um serviço Java ou Spring Boot deve receber credenciais: `${DB_PASSWORD}` vindo do ambiente ou um arquivo em `/run/secrets`.
- Entender por que uma rotação "não pegou" em parte da frota.
- Reduzir os lugares por onde um segredo pode vazar: crash dumps, endpoints de debug, processos filhos, ferramentas no nível do nó.

## Deep Dive

### Os dois mecanismos

```yaml
containers:
  - name: app
    image: busybox:1.37
    env:
      - name: DB_PASSWORD                  # uma chave, renomeada se quiser
        valueFrom:
          secretKeyRef: { name: tenant-alpha, key: DB_PASSWORD }
    envFrom:
      - secretRef: { name: tenant-beta }   # cada chave vira uma variável
        prefix: BETA_
    volumeMounts:
      - name: secrets
        mountPath: /run/secrets
        readOnly: true
volumes:
  - name: secrets
    secret:
      secretName: tenant-alpha
```

Variáveis de ambiente são resolvidas **uma vez**, quando o container sobe, e copiadas para o ambiente do processo. Arquivos montados são mantidos pelo kubelet enquanto o Pod estiver rodando.

### O que a rotação faz de verdade

O experimento, no k3s v1.36: um Pod lê o `DB_PASSWORD` da `tenant-alpha` de três jeitos (env var, montagem do volume inteiro, montagem `subPath` da chave isolada), e então a Secret é atualizada:

```bash
kubectl -n example create secret generic tenant-alpha \
  --from-literal=DB_USER=alpha_app --from-literal=DB_PASSWORD=rotated-999 \
  --dry-run=client -o yaml | kubectl apply -f -
```

| Consumidor | Valor depois da rotação |
|---|---|
| volume montado (`/run/secrets/DB_PASSWORD`) | `rotated-999`, depois de uns 74 a 79 segundos |
| variável de ambiente (`printenv DB_PASSWORD`) | continua `alpha-s3cret` |
| montagem `subPath` (`/etc/alpha-pass`) | continua `alpha-s3cret` |

- **Volumes** são atualizados pelo sync periódico do kubelet. O atraso é o período de sync do kubelet (1 minuto por padrão) mais o tempo que o cache de Secrets dele leva para perceber a mudança, então "cerca de um minuto, às vezes um pouco mais" é a expectativa honesta, não "instantâneo".
- **Variáveis de ambiente** pertencem ao processo. O Kubernetes não consegue mudar o ambiente de um processo em execução, então o valor antigo fica até o container reiniciar.
- **`subPath`** faz bind mount de um único arquivo do volume. O kubelet atualiza um volume escrevendo um diretório novo com timestamp e trocando o symlink `..data`, e uma montagem `subPath` fica presa ao arquivo original, então nunca vê a troca. A documentação diz isso com todas as letras: um container que usa uma Secret como montagem `subPath` não recebe atualizações.

Normalmente se usa `subPath` para colocar um arquivo dentro de um diretório que já tem outro conteúdo (por exemplo, um keystore sozinho em `/etc/ssl/`). Se o arquivo precisa acompanhar a rotação, monte o volume no seu próprio diretório e aponte a aplicação para lá.

### Um arquivo que muda só ajuda se você o ler de novo

O kubelet atualizar `/run/secrets/DB_PASSWORD` não faz nada por uma aplicação que leu o arquivo uma vez na inicialização e guardou num pool de conexões. As opções, da mais simples:

- **Reiniciar quando mudar.** `kubectl rollout restart deployment/app` depois de rotacionar, ou colocar um hash da Secret numa annotation do template do Pod (o padrão `checksum/secret` do Helm), para que qualquer mudança dispare um rolling update. Funciona igual para env vars e arquivos.
- **Reler a cada uso ou em falha.** Ler o arquivo ao abrir uma conexão nova, ou recarregar ao receber um erro de autenticação. Barato, e cabe na janela de propagação de "cerca de um minuto".
- **Observar o diretório.** Observe `/run/secrets` esperando a troca do symlink `..data`, não o arquivo individual. Um watch em `/run/secrets/DB_PASSWORD` segue o symlink até o arquivo dentro do diretório antigo com timestamp, que o kubelet apaga durante a troca, então o watch termina com um evento de remoção em vez de reportar uma modificação.
- **Reload do framework.** O Spring Cloud Kubernetes consegue recarregar beans quando Secrets mudam, e ferramentas como o Stakater Reloader reiniciam workloads automaticamente.

### Por onde cada forma vaza

O mesmo Pod, inspecionado de ângulos diferentes:

```bash
$ kubectl describe pod app | grep DB_PASSWORD
DB_PASSWORD:  <set to the key 'DB_PASSWORD' in secret 'tenant-alpha'>  Optional: false

$ kubectl exec app -- sh -c 'tr "\0" "\n" < /proc/1/environ | grep DB_'
DB_PASSWORD=alpha-s3cret

$ crictl inspect <container-id> | grep DB_PASSWORD     # no nó
          "DB_PASSWORD=alpha-s3cret",
```

`kubectl describe` mostra só a referência, mas o valor resolvido está no ambiente do processo e no spec do container no runtime do nó. Variáveis de ambiente também são herdadas por todo processo filho, impressas por muitos crash reporters e páginas de erro, e expostas por endpoints de debug que despejam o ambiente. Um arquivo em `/run/secrets` só é lido por processos que o abrem, pode ser restringido com `defaultMode: 0400`, e não viaja para processos filhos por padrão.

## Trade-offs

- **Env vars são as mais fáceis de consumir, e as mais difíceis de rotacionar ou conter.** Toda linguagem e framework as lê nativamente, e o modelo twelve-factor assume que elas existem. Em troca, rotacionar sempre significa reiniciar, e o valor pode aparecer em qualquer lugar onde o ambiente é despejado.
  ```properties
  # Spring Boot, env var: resolvida uma vez na inicialização
  spring.datasource.password=${DB_PASSWORD}
  ```
- **Arquivos são rotacionados no lugar, mas só se a aplicação colaborar.** O kubelet faz a parte dele em cerca de um minuto; a aplicação ainda precisa reler. Para bibliotecas que só recebem uma string na inicialização, arquivos não dão vantagem de rotação sobre env vars, só a de superfície de vazamento.
  ```properties
  # Spring Boot, arquivos: /run/secrets/DB_PASSWORD vira a propriedade DB_PASSWORD
  spring.config.import=optional:configtree:/run/secrets/
  ```
- **`subPath` é uma conveniência que desliga as atualizações em silêncio.** Serve para arquivos que nunca mudam, é uma armadilha para qualquer coisa que é rotacionada.
- **Reiniciar quando mudar é a estratégia de rotação mais previsível.** É mais lenta do que recarregar no lugar, mas todo Pod converge para o mesmo valor através de um rolling update normal e observável, e funciona do mesmo jeito para env vars e arquivos.

## Documentation Links

- [Distribute Credentials Securely Using Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/): exemplos de `env`, `envFrom` e volume.
- [Kubernetes docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/): Secrets montadas são atualizadas automaticamente, env vars e `subPath` não.
- [Kubernetes docs: Volumes](https://kubernetes.io/docs/concepts/storage/volumes/): `subPath` e a ausência de atualizações.
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/): limitando a exposição dentro dos containers.
