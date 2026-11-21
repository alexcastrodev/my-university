---
version: 1.0
updatedAt: 2026-11-21
---
# O modelo de responsabilidade compartilhada da AWS: quem protege o quê, serviço por serviço

> Domínio do exame: **Segurança e Conformidade (30%)**, objetivo 2.1 *Entender o modelo de responsabilidade compartilhada da AWS*.

---

## A regra em uma frase

A AWS é responsável pela **segurança DA nuvem**. O cliente é responsável pela **segurança NA nuvem**.

- **DA nuvem (AWS):** o hardware, o software, a rede e as instalações que executam os serviços da Nuvem AWS, desde o **sistema operacional do host e a camada de virtualização** até a **segurança física** dos data centers.
- **NA nuvem (cliente):** o que você coloca por cima e como configura: atualizações e patches do sistema operacional convidado, software de aplicação, regras de grupos de segurança, seus dados, opções de criptografia, classificação de dados e permissões do IAM.

O lado do cliente não é fixo. Ele depende de **quais serviços você escolhe**, da sensibilidade dos seus dados, dos requisitos da sua empresa e das leis e regulamentações que se aplicam a você.

```text
 +-------------------------------------------------------------+
 |  CUSTOMER: security IN the cloud                            |
 |  data, classification, IAM permissions, encryption choices, |
 |  application code and config, guest OS (when you have one), |
 |  security groups, network placement                         |
 +-------------------------------------------------------------+
 |  AWS: security OF the cloud                                 |
 |  software that runs the services, host OS, virtualization,  |
 |  hardware, networking, facilities and physical security     |
 +-------------------------------------------------------------+
```

---

## Como a linha se move conforme o serviço

Quanto mais a AWS gerencia, menos camadas ficam com você. O exame cita **Amazon EC2, Amazon RDS e AWS Lambda** como exemplos, e gosta de usar Amazon S3 e Amazon DynamoDB como a ponta "abstraída".

| Serviço | O que a AWS cuida | O que o cliente cuida |
|---------|-------------------|-----------------------|
| **Amazon EC2** (você recebe um servidor virtual) | Host físico, hypervisor, rede, instalações | Sistema operacional convidado e todo software nele, **incluindo atualizações e patches de segurança**; regras de grupos de segurança e configurações da VPC; as credenciais usadas para se conectar à instância; perfis (roles) do IAM anexados à instância |
| **Amazon RDS** (banco de dados gerenciado) | Os processos que o RDS gerencia, como **criar backups automatizados** e **replicar para réplicas de leitura** | Posicionamento na VPC, grupos de segurança, políticas do IAM para gerenciar o RDS, conexões SSL/TLS, decidir se **habilita a criptografia em repouso**, logins do mecanismo de banco de dados, a janela de backup e o período de retenção desejados |
| **AWS Lambda** (funções sem servidor) | Infraestrutura subjacente, serviços de base, **o sistema operacional e a plataforma de aplicação**; publicação de runtimes atualizados (e sua aplicação no modo automático padrão) | O **código da sua função** e as **permissões do IAM** para o serviço Lambda e dentro da função |
| **Amazon S3, Amazon DynamoDB** (serviços abstraídos) | Infraestrutura, sistema operacional e plataforma | Seus dados, a criptografia deles e as permissões sobre eles |

Uma forma rápida de classificar qualquer item: **se você pode fazer login nessa camada ou configurá-la, ela é sua.** No EC2 você faz login no sistema operacional convidado, então os patches dele são seus. No Lambda não há sistema operacional ao seu alcance, então não há nada para aplicar patch nesse nível.

### Dois detalhes que o exame transforma em armadilhas

**Backups do RDS.** O RDS **cria e salva backups automatizados** durante a janela de backup que você configura e os mantém pelo período de retenção que você define. Portanto, "quem realiza os backups do RDS" é a AWS, enquanto "quem escolhe a janela e a retenção" é você.

**Criptografia do RDS.** A criptografia em repouso é **uma escolha sua, feita quando você cria a instância**. A AWS fornece o mecanismo (chaves do AWS KMS), mas não decide por você. A criptografia só pode ser ativada na criação. Para criptografar uma instância existente sem criptografia:

```text
unencrypted DB  ->  snapshot  ->  copy the snapshot WITH encryption  ->  restore a new, encrypted DB
```

Você não pode restaurar um backup ou snapshot sem criptografia diretamente para uma instância criptografada.

**Imagens de contêiner do Lambda.** Se você empacota uma função como **imagem de contêiner**, o runtime vai dentro da sua imagem. Quando uma imagem base atualizada é lançada, **você reconstrói a imagem a partir da imagem base mais recente e faz o redeploy**. As atualizações automáticas de runtime cobrem apenas funções que usam um runtime gerenciado do Lambda.

---

## Controles: herdados, compartilhados e específicos do cliente

O modelo também classifica os controles de TI em três grupos.

| Tipo de controle | Significado | Exemplo da AWS |
|------------------|-------------|----------------|
| **Herdado** | Você assume o controle da AWS por completo | Controles **físicos e ambientais** |
| **Compartilhado** | Os dois lados o aplicam, cada um na sua camada | **Gerenciamento de patches** (a AWS aplica patches na sua infraestrutura, você nos sistemas operacionais convidados e nas aplicações), **gerenciamento de configuração** (a AWS configura seus dispositivos, você configura o sistema operacional convidado, os bancos de dados e as aplicações), **conscientização e treinamento** (cada lado treina as próprias pessoas) |
| **Específico do cliente** | Somente o cliente, pois depende de como você usa os serviços | **Proteção de serviços e comunicações ou segurança de zonas** |

"O gerenciamento de patches é compartilhado" e "o patch do sistema operacional convidado do EC2 é do cliente" são ambas verdadeiras. A primeira trata do controle como um todo; a segunda trata da sua metade dele.

---

## A conformidade segue a mesma divisão

Auditores independentes testam regularmente **os controles da própria AWS** por meio dos programas de conformidade da AWS, e a AWS publica quais serviços cada programa cobre ("AWS Services in Scope by Compliance Program"). Isso comprova a camada da AWS. Não torna o seu workload em conformidade: **você continua responsável pela sua própria conformidade**, incluindo seus dados, sua configuração e suas regras de acesso. A lição 2.2 mostra onde baixar os relatórios da AWS (AWS Artifact).

---

## Classificando itens comuns

| Item | Responsável |
|------|-------------|
| Substituir discos com falha, acesso físico aos data centers | AWS |
| Hypervisor e sistema operacional do host do EC2 | AWS |
| Patches do sistema operacional convidado em uma instância EC2 | Cliente |
| Regras de grupos de segurança | Cliente |
| Rotacionar as chaves de acesso dos usuários do IAM | Cliente |
| Decidir quem pode ler um bucket do S3 | Cliente |
| Classificar os dados e escolher a criptografia | Cliente |
| Realizar os backups automatizados do RDS | AWS (você escolhe a janela e a retenção) |
| Aplicar patches no sistema operacional sob uma função Lambda | AWS |
| Reconstruir uma imagem de contêiner do Lambda com uma imagem base atualizada | Cliente |
| Código da aplicação, sua configuração e sua segurança | Cliente |

---

## Atenção

- **"A AWS gerencia, então a AWS protege a minha configuração."** Não. Um serviço gerenciado oculta o sistema operacional, não os seus dados, permissões ou configurações. Regra: gerenciado significa menos camadas para você, nunca zero.
- **A segurança da aplicação é do cliente.** Distratores que tornam a AWS responsável por "seguir as melhores práticas na sua nova aplicação" estão errados. Regra: seu código e sua configuração ficam sempre do seu lado.
- **Patches no EC2 vs RDS.** EC2: você aplica patches no sistema operacional convidado. RDS: você nunca faz login no host do banco de dados, então o sistema operacional dele não é seu. Regra: a camada em que você pode fazer login é sua.
- **Backups e criptografia do RDS.** A AWS realiza os backups automatizados; você escolhe a janela e a retenção. Você escolhe a criptografia, e somente na criação. Regra: a AWS executa o processo, você toma a decisão.
- **Físico e ambiental = herdado; conscientização e treinamento = compartilhado.** Regra: se os dois lados têm pessoas ou dispositivos que precisam dele, é compartilhado.
- **Os relatórios de conformidade da AWS não certificam o seu workload.** Regra: a AWS comprova a camada dela; você comprova a sua.

> Material de estudo antigo diz que os backups de banco de dados no RDS são responsabilidade do cliente; a documentação oficial atual diz que o próprio RDS cria os backups automatizados, e o cliente apenas configura a janela de backup e o período de retenção (e pode tirar snapshots manuais).

---

## Verificação rápida

1. Uma empresa executa Linux no Amazon EC2. Quem instala os patches de segurança do sistema operacional? **O cliente.**
2. Quem realiza os backups automatizados de uma instância do Amazon RDS? **A AWS (RDS), durante a janela e com a retenção que o cliente define.**
3. Uma instância do RDS foi criada sem criptografia. É possível ativá-la no mesmo lugar? **Não. Crie um snapshot, faça uma cópia criptografada e restaure uma nova instância.**
4. Qual controle é totalmente herdado da AWS? **Os controles físicos e ambientais.**
5. Uma função Lambda é implantada como imagem de contêiner e sua imagem base recebe uma correção de segurança. Quem age? **O cliente reconstrói a imagem e faz o redeploy.**

---

## Documentação oficial

- [Shared Responsibility Model](https://aws.amazon.com/compliance/shared-responsibility-model/)
- [Security in Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security.html)
- [Security in Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.html)
- [Amazon RDS automated backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)
- [Encrypting Amazon RDS resources](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)
- [Lambda: the shared responsibility model](https://docs.aws.amazon.com/whitepapers/latest/security-overview-aws-lambda/the-shared-responsibility-model.html)
- [Lambda runtime updates and shared responsibility](https://docs.aws.amazon.com/lambda/latest/dg/runtime-management-shared.html)
