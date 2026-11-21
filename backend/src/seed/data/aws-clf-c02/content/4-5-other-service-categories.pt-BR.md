---
version: 1.0
updatedAt: 2026-11-21
---
# Outras categorias de serviços: integração, aplicações de negócios, ferramentas de desenvolvimento, monitoramento, computação para o usuário final, IoT e migração

> Domínio do exame: **Tecnologia e serviços de nuvem (34%)**, objetivo 3.8 *Identificar serviços de outras categorias de serviços da AWS no escopo*.

---

## O que o exame cobra

O objetivo 3.8 é um passeio por categorias, cada uma com um ou dois serviços: **integração de aplicações** (EventBridge, SNS, SQS), **aplicações de negócios** (Amazon Connect, Amazon SES), **capacitação de clientes** (AWS Support), **ferramentas de desenvolvimento** (CodeBuild, CodePipeline, X-Ray), **computação para o usuário final** (AppStream 2.0, WorkSpaces, WorkSpaces Secure Browser), **frontend web e mobile** (Amplify) e **IoT** (IoT Core). As habilidades são todas "escolher o serviço para esta necessidade".

---

## Integração de aplicações: push, pull, evento ou fluxo de trabalho

| Necessidade | Serviço | Modelo |
|-------------|---------|--------|
| Armazenar trabalho em buffer entre componentes para que um consumidor lento não perca mensagens | **Amazon SQS** | Fila: os consumidores **puxam** (fazem polling de) mensagens |
| Enviar uma mensagem a muitos assinantes de uma só vez (filas, Lambda, e-mail, SMS, push para dispositivos móveis) | **Amazon SNS** | Tópico pub/sub: a AWS **envia** a cada assinante |
| Reagir a eventos de serviços da AWS, de aplicações SaaS ou do seu código, ou executar algo em uma programação | **Amazon EventBridge** | Barramento de eventos com regras, mais o EventBridge Scheduler (cron, rate, única vez) |
| Coordenar várias etapas em ordem, com ramificações e novas tentativas | **AWS Step Functions** | Fluxo de trabalho visual (máquina de estados) |

- **Tipos de fila do SQS**: Standard (throughput quase ilimitado, entrega pelo menos uma vez, ordem por melhor esforço) e **FIFO** (processamento exatamente uma vez e ordem estrita).
- **Fanout**: um tópico do SNS com várias filas do SQS inscritas entrega um evento a vários processadores independentes.
- O EventBridge se chamava antes CloudWatch Events; a documentação antiga agora abre o guia do EventBridge.

```text
 Pedido feito --> tópico SNS --+--> fila SQS --> serviço de cobrança
                               +--> fila SQS --> serviço de envio
                               +--> e-mail para o cliente
```

---

## Aplicações de negócios e capacitação de clientes

| Necessidade | Serviço |
|-------------|---------|
| Uma central de contato na nuvem que conecta clientes a atendentes com roteamento inteligente | **Amazon Connect** |
| Enviar e receber e-mail (transacional, marketing, newsletters) a partir dos seus próprios domínios | **Amazon SES** (Simple Email Service) |
| Ajuda técnica, suporte por casos e orientação da AWS | **AWS Support** (planos na lição 5-3) |

O SES é e-mail. Mensagens de texto e push para dispositivos móveis a assinantes vêm do SNS.

---

## Ferramentas de desenvolvimento e monitoramento

| Necessidade | Serviço |
|-------------|---------|
| Compilar código-fonte, executar testes unitários e produzir artefatos implantáveis sem servidores de build | **AWS CodeBuild** |
| Modelar, visualizar e automatizar as etapas de release do commit até a produção | **AWS CodePipeline** |
| Rastrear uma requisição por microsserviços para descobrir qual deles adiciona latência | **AWS X-Ray** |
| Métricas, alarmes, painéis e logs de recursos e aplicações | **Amazon CloudWatch** |
| Quem fez o quê: registro de chamadas de API feitas por usuários, perfis (roles) e serviços | **AWS CloudTrail** |
| Operar frotas de servidores em escala: aplicação de patches de segurança, Run Command, Session Manager, Parameter Store | **AWS Systems Manager** |

```text
 "Está lento ou quebrado?"          -> CloudWatch (métricas, alarme em um limite)
 "Onde na cadeia está o problema?"  -> X-Ray (mapa de rastreamento entre serviços)
 "Quem mudou?"                      -> CloudTrail (registro de atividade de API)
```

- Os **alarmes** do CloudWatch observam uma métrica em relação a um limite e podem notificar ou disparar uma ação automatizada. O **agente do CloudWatch** coleta métricas e logs de instâncias EC2 e de servidores no local (on-premises).
- Os pontos de dados de métricas do CloudWatch expiram após 15 meses.
- O Histórico de eventos do CloudTrail guarda os últimos 90 dias de eventos de gerenciamento sem custo; uma trilha (trail) entrega eventos ao S3 para guardá-los por mais tempo.
- Fora do escopo, não os escolha como respostas: AWS CodeDeploy, AWS CodeArtifact, AWS CloudShell.

---

## Computação para o usuário final

| Necessidade | Serviço |
|-------------|---------|
| Uma área de trabalho virtual completa e persistente (Windows ou Linux) para cada colaborador, acessível de qualquer dispositivo | **Amazon WorkSpaces** |
| Transmitir uma aplicação de desktop para os navegadores dos usuários sem instalá-la localmente | **Amazon AppStream 2.0** (agora chamado Amazon WorkSpaces Applications) |
| Dar aos usuários acesso seguro a sites internos e aplicações SaaS por meio de um navegador remoto, sem VPN nem software cliente | **Amazon WorkSpaces Secure Browser** |

- O WorkSpaces Personal oferece uma área de trabalho persistente por usuário; o WorkSpaces Pool oferece áreas de trabalho não persistentes.
- O WorkSpaces Secure Browser executa a sessão do navegador na AWS e transmite apenas pixels criptografados para o navegador local. Não é uma área de trabalho.

---

## Frontend web e mobile, e IoT

- **AWS Amplify**: criar e hospedar aplicações web e mobile full-stack. O Amplify Hosting oferece um fluxo de trabalho baseado em Git com implantação contínua na rede de entrega de conteúdo da AWS.
- **AWS IoT Core**: conectar dispositivos IoT à nuvem, entre si e a serviços da AWS, e rotear as mensagens deles. Ele não analisa os dados por conta própria: a manutenção preditiva precisa de um serviço de ML, como o SageMaker AI, por cima.

Não citado no guia do exame: AWS AppSync (APIs GraphQL). Fora do escopo: AWS IoT Greengrass (runtime de borda) e AWS Device Farm (testes em celulares reais).

---

## Migração e transferência (visão por serviço)

A lição 1-3 cobre as estratégias. Aqui, associe **o que está sendo movido** ao serviço.

| O que é movido | Serviço |
|----------------|---------|
| Servidores inteiros, rehospedados no EC2 com replicação contínua e uma virada curta | **AWS Application Migration Service** (agora chamado AWS Transform MGN) |
| Dados de banco de dados, uma única vez ou com replicação contínua | **AWS Database Migration Service (DMS)** |
| Um esquema de banco de dados para um mecanismo diferente | **AWS Schema Conversion Tool (SCT)** |
| Nada ainda: um business case baseado em dados e uma estimativa de custo dimensionada corretamente | **Migration Evaluator** |

O AWS Application Discovery Service e o AWS Migration Hub continuam no guia do exame, mas não estão mais abertos a novos clientes. Não citados no guia do exame: AWS DataSync (transferência de arquivos online) e os dispositivos da família Snow, que estão fechados a novos clientes.

---

## Atenção

- **SQS é pull, SNS é push.** "Muitos assinantes de uma só vez" é SNS; "reter mensagens até que um worker esteja livre" é SQS.
- **Exatamente uma vez e em ordem indica uma fila SQS FIFO,** não uma fila Standard.
- **O EventBridge reage a eventos e a programações; um alarme do CloudWatch reage a um limite de métrica.** "Toda noite às 19h" é EventBridge Scheduler.
- **O Step Functions orquestra; o SQS apenas armazena em buffer.** Novas tentativas, ramificações e etapas ordenadas apontam para o Step Functions.
- **O SES envia e-mail; o SNS envia também SMS e push.**
- **CloudWatch é performance, CloudTrail é auditoria, X-Ray é rastreamento.**
- **WorkSpaces é uma área de trabalho, AppStream 2.0 é uma aplicação, Secure Browser é um navegador.**
- **O IoT Core conecta dispositivos; não é a camada de análise nem de ML.**

## Verificação rápida

1. Um evento de pedido precisa chegar a três filas de processamento independentes. **Tópico SNS com fanout para filas SQS.**
2. Prestadores de serviço precisam de uma área de trabalho Windows completa a partir de seus notebooks pessoais. **Amazon WorkSpaces.**
3. Descobrir qual microsserviço adiciona 800 ms ao checkout. **AWS X-Ray.**
4. Uma empresa quer uma central de contato na nuvem que encaminhe as chamadas dos clientes ao atendente certo. **Amazon Connect.**
5. Mover 300 VMs para o EC2 sem alterações e com tempo de inatividade mínimo. **AWS Application Migration Service.**

## Documentação oficial

- [What is Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
- [What is Amazon SNS](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)
- [What is Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html)
- [What is AWS Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
- [What is AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/aws-xray.html)
- [What is Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html)
- [What is Amazon WorkSpaces](https://docs.aws.amazon.com/workspaces/latest/adminguide/amazon-workspaces.html)
- [What is AWS IoT](https://docs.aws.amazon.com/iot/latest/developerguide/what-is-aws-iot.html)
