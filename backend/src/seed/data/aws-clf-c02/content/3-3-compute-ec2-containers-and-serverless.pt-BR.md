---
version: 1.0
updatedAt: 2026-11-21
---
# Computação na AWS: EC2, Auto Scaling, contêineres, serverless, Lightsail e Batch

> Domínio do exame: **Tecnologia e Serviços de Nuvem (34%)**, objetivo 3.3 *Identificar os serviços de computação da AWS*.

---

## O que o exame quer

O guia cita cinco competências: **tipos de instância EC2** (otimizada para computação, otimizada para armazenamento), **opções de contêineres** (Amazon ECS, Amazon EKS), **computação sem servidor (serverless)** (AWS Fargate, AWS Lambda), **Auto Scaling para elasticidade** e a **finalidade dos balanceadores de carga**. Batch, Lightsail, Elastic Beanstalk e Outposts também estão na lista de computação. A competência real é escolher quanto do servidor você quer gerenciar.

```text
 you manage more                                              you manage less
 ---------------------------------------------------------------------------
 EC2 instance  ->  ECS/EKS on EC2  ->  ECS/EKS on Fargate  ->  Lambda function
 (OS, patches)     (hosts + containers)  (containers only)       (code only)
```

---

## Fundamentos do Amazon EC2

- Uma **AMI** (Amazon Machine Image) fornece o software para inicializar uma instância, mais um mapeamento de dispositivos de bloco. Você precisa escolher uma na inicialização, e uma AMI inicia muitas instâncias configuradas de forma idêntica. Uma AMI pertence a uma Região.
- O assistente de inicialização oferece **AMIs Quick Start** e um catálogo completo de AMIs; AMIs pagas de fornecedores vêm do **AWS Marketplace**.
- Uma AMI personalizada "golden" é a forma de fazer todo novo servidor começar com o mesmo sistema operacional reforçado e os mesmos agentes.

### Famílias de instâncias

| Família | Projetada para | Pista do cenário |
|---------|----------------|------------------|
| **Uso geral** | CPU, memória e rede equilibradas; inclui tipos `T` com capacidade de burst, com uma CPU de base que pode sofrer burst | Servidores web, aplicações pequenas, desenvolvimento e teste |
| **Otimizada para computação** | CPU alta em relação à memória | Simulações limitadas por CPU, processamento em lote, servidores de jogos |
| **Otimizada para memória** | Memória grande (os tipos de alta memória `U` ficam aqui) | Bancos de dados e caches em memória |
| **Otimizada para armazenamento** | Alto throughput de armazenamento local (tipos `D` e `I`) | Grandes conjuntos de dados em discos locais |
| **Computação acelerada** | GPUs e outros aceleradores | Machine learning, gráficos |
| **Computação de alto desempenho** | HPC fortemente acoplada | Modelagem científica |

O nome de um tipo é família mais tamanho. Em `c7g.large`, `c` é a série, `7` a geração, `g` um atributo (Graviton) e `large` o tamanho. Outras letras de atributo incluem `a` (AMD), `i` (Intel) e `d` (armazenamento de instância).

### Opções de compra em uma linha cada (detalhes na lição 5-1)

Sob demanda (sem compromisso, cobrada por segundo com mínimo de 60 segundos), Savings Plans e instâncias reservadas (compromisso de 1 ou 3 anos em troca de desconto), Spot (capacidade ociosa que o EC2 pode interromper; você paga o preço Spot atual definido pelo EC2, não há lances), Dedicated Hosts (um servidor físico inteiro, para licenças por núcleo ou por soquete), Dedicated Instances (hardware de locatário único), Capacity Reservations (capacidade em uma AZ).

---

## Amazon EC2 Auto Scaling e balanceadores de carga

| Conceito | Significado |
|----------|-------------|
| **Grupo do Auto Scaling** | Um conjunto de instâncias com tamanho **mínimo**, **desejado** e **máximo**; o escalonamento fica dentro do mínimo e do máximo |
| **Verificações de integridade** | Instâncias encerradas ou comprometidas são substituídas automaticamente |
| **Várias AZs** | Um grupo pode abranger várias AZs de uma Região e é balanceado de forma uniforme entre elas |
| **Opções de escalonamento** | Manual, **agendado** (picos conhecidos), **dinâmico** (acompanha uma métrica), **preditivo** (previsão a partir do histórico) |
| **Modelo de execução (launch template)** | Descreve o que iniciar; **versionado**, recomendado pela AWS, necessário para combinar Spot e sob demanda ou vários tipos de instância |
| **Configuração de execução (launch configuration)** | O objeto legado: não pode ser modificado após a criação e não é mais recomendado |

O **Elastic Load Balancing** distribui o tráfego de entrada entre vários destinos em uma ou mais AZs, verifica a integridade deles e envia tráfego apenas para destinos íntegros. O Auto Scaling muda **quantas** instâncias executam; o balanceador de carga decide **qual** instância íntegra recebe cada requisição. Juntos, eles dão elasticidade e alta disponibilidade. (Os tipos de balanceador de carga são abordados no módulo 4.)

> Material de estudo antigo apresenta as configurações de execução como atuais, e um livro diz que os modelos de execução "não podem ser modificados". A documentação oficial atual diz que os modelos de execução são versionados, que as configurações de execução são imutáveis e que contas criadas em ou após 1º de outubro de 2024 não conseguem criar configurações de execução.

---

## Contêineres: ECS, EKS, ECR

| Serviço | O que é | Escolha quando |
|---------|---------|----------------|
| **Amazon ECS** (Elastic Container Service) | Um serviço de orquestração de contêineres totalmente gerenciado da AWS | Você quer executar contêineres do jeito da AWS, com o mínimo de orquestração a aprender |
| **Amazon EKS** (Elastic Kubernetes Service) | Um serviço Kubernetes totalmente gerenciado; a AWS gerencia o plano de controle | A equipe já usa manifestos e ferramentas do Kubernetes, ou precisa de portabilidade do Kubernetes |
| **Amazon ECR** (Elastic Container Registry) | Um registro gerenciado de imagens de contêiner, com repositórios privados e permissões do IAM | Você precisa de um lugar para armazenar e obter imagens de contêiner |

Tanto o ECS quanto o EKS podem executar contêineres em instâncias EC2 que você gerencia ou no **AWS Fargate**.

---

## Computação serverless: Fargate e Lambda

| | **AWS Fargate** | **AWS Lambda** |
|--|-----------------|----------------|
| Unidade que você implanta | Um contêiner (tarefa do ECS ou Pod do EKS) | Uma função (código) |
| Servidores a gerenciar | Nenhum; você escolhe CPU e memória por tarefa | Nenhum; a AWS cuida da capacidade, do escalonamento e dos patches |
| Gatilho típico | Um serviço de longa duração ou uma tarefa que você inicia | Um evento: um upload no S3, uma chamada de API, uma mensagem de fila |
| Modelo de cobrança | Pagamento conforme o uso pelos recursos que a tarefa solicita | Requisições mais duração (GB-segundos); nada enquanto ocioso |

- O Fargate é um mecanismo de computação serverless, com pagamento conforme o uso, para contêineres, e cada tarefa tem seu próprio limite de isolamento.
- O Lambda executa código sem provisionar nem gerenciar servidores e escala com o número de eventos.
- O Lambda tem um tempo máximo de execução por invocação; em 21/11/2026, atualmente é de 30 minutos para funções padrão. Trabalhos longos, que duram horas, pertencem a contêineres, Batch ou EC2.

> Material de estudo antigo diz que uma função Lambda pode executar "no máximo 15 minutos". A documentação oficial atual diz que o tempo limite máximo é de 1.800 segundos (30 minutos) em 21/11/2026. O número já mudou antes, então questões de design não devem depender dele.

---

## Lightsail, Batch e Elastic Beanstalk

| Serviço | Escolha quando |
|---------|----------------|
| **Amazon Lightsail** | Uma pequena empresa ou um iniciante quer um servidor virtual privado simples (WordPress, LAMP, imagens Windows), bancos de dados gerenciados ou um balanceador de carga com **preço mensal fixo em pacote**. Os snapshots podem ser exportados para o EC2 depois |
| **AWS Batch** | Você precisa executar um grande número de jobs em lote; o Batch provisiona a computação (EC2, Fargate) e enfileira os jobs. Sem cobrança adicional, você paga pelos recursos |
| **AWS Elastic Beanstalk** | Você envia uma aplicação web e deixa a AWS provisionar instâncias, balanceamento de carga e escalonamento (lição 3-1) |

**Não citado no guia do exame (apenas contexto):** os grupos de posicionamento do EC2 (cluster, partição, distribuição) controlam como as instâncias são posicionadas no hardware, para baixa latência ou isolamento de falhas. O guia não os lista, então aprenda apenas o nome.

---

## Atenção

- **"Nenhum servidor para gerenciar com contêineres" é o Fargate**, não o ECS no EC2. ECS e EKS são orquestradores; o Fargate é o mecanismo serverless por baixo deles.
- **Habilidades ou manifestos existentes do Kubernetes apontam para o EKS.** O ECS é o orquestrador próprio da AWS.
- **O ECR armazena imagens; ele não as executa.**
- **O Auto Scaling muda o número de instâncias**, não o tamanho delas, e funciona dentro de uma Região. Distribuir as requisições é tarefa do balanceador de carga.
- **Pico diário conhecido significa escalonamento agendado.** O escalonamento dinâmico reage depois que a métrica se move.
- **Modelos de execução são a forma atual e versionada** de descrever o que o Auto Scaling inicia.
- **Spot significa interrompível.** Nunca para um workload que não pode parar.
- **O Lightsail é a opção simples de preço fixo**; ele inclui imagens de WordPress.
- **O Lambda é orientado a eventos e de curta duração.** Processamento de horas é Batch, contêineres ou EC2.

## Verificação rápida

1. Uma simulação limitada por CPU precisa de pouca memória. Qual família de instâncias? **Otimizada para computação.**
2. Uma equipe quer executar contêineres sem nunca aplicar patches nem escalar os hosts subjacentes. Qual serviço? **AWS Fargate.**
3. O tráfego sobe todo dia útil às 09:00 e a capacidade precisa estar pronta antes. Qual opção de escalonamento? **Escalonamento agendado.**
4. Miniaturas precisam ser criadas toda vez que uma imagem chega ao S3, sem nada executando quando ocioso. Qual serviço? **AWS Lambda.**
5. Qual serviço armazena imagens de contêiner para ECS e EKS? **Amazon ECR.**

## Documentação oficial

- [Amazon Machine Images (AMIs)](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html)
- [Amazon EC2 instance types](https://docs.aws.amazon.com/ec2/latest/instancetypes/instance-types.html)
- [What is Amazon EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html)
- [What is Elastic Load Balancing](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html)
- [What is Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)
- [What is Amazon EKS](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)
- [What is AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [What is Amazon Lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/what-is-amazon-lightsail.html)
